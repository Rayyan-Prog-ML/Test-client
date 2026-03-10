
import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Scene, ProjectState, ProcessingStatus, ChapterOutline } from './types';
import { 
  generateScenes, 
  generateImagePrompts, 
  generateVideoPrompts, 
  generateImageForScene, 
  generateVideoForScene,
  generateStoryOutline, 
  auditStoryOutline,
  generateStoryChapter, 
  generateVoiceOver, 
  generateVoiceOverForScenes,
  verifyApiKeys, 
  masterAuditScript, 
  trimSilenceFromAudio,
  generateThumbnailPrompt,
  determineScriptFramework,
  STYLE_KEYWORDS, 
  SAFETY_BLOCK 
} from './services/geminiService';
import Timeline from './components/Timeline';
import Player from './components/Player';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [project, setProject] = useState<ProjectState>({
    videoTitle: '', audioFile: null, audioDuration: 0, scriptText: '', ttsVoice: 'onyx', scenes: [], aspectRatio: '16:9',
    backgroundAudioFile: null, backgroundVolume: 0.05, enableBackgroundMusic: false, enableEmbers: true, 
    filmGrainStrength: 0.2, enableVaporOverlay: false,
    vaporOverlayFile: null, vaporOverlayOpacity: 0.5, generatedMetadata: null, viralWordsCandidates: [],
    selectedViralWord: null, generatedThumbnails: [],
    thumbnailStudio: { isOpen: false, referenceImages: [], analyzedStyles: [], customTitle: '', generatedImage: null, isAnalyzing: false, isGenerating: false },
    visualStage: 'idle'
  });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>({ step: 'idle', progress: 0, message: '' });
  const [keyCount, setKeyCount] = useState(0);
  
  const [showScriptWizard, setShowScriptWizard] = useState(false);
  const [wizardTopic, setWizardTopic] = useState('');
  const [previewScene, setPreviewScene] = useState<Scene | null>(null);
  
  const audioInputRef = useRef<HTMLInputElement>(null);
  const bulkImageInputRef = useRef<HTMLInputElement>(null);
  const bulkVideoInputRef = useRef<HTMLInputElement>(null);
  const sceneImportInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    verifyApiKeys().then(count => setKeyCount(count));
  }, []);

  useEffect(() => {
    if (project.scriptText) {
      console.log("Script Text Updated. Length:", project.scriptText.length);
    }
  }, [project.scriptText]);

  const handleAutomatedPipeline = async () => {
      if (!wizardTopic) {
          alert("Please enter a topic first.");
          return;
      }
      setShowScriptWizard(false);
      setStatus({ step: 'refining', progress: 5, message: 'Step 1: Architecting Viral Script...' });
      
      try {
          // 1. Determine Framework
          const durationKey = await determineScriptFramework(wizardTopic);
          setStatus({ step: 'refining', progress: 5, message: `Step 1: Architecting ${durationKey}-Minute Viral Script...` });

           // 2. Generate Script (Doc Writer)
          const rawChapters = await generateStoryOutline(wizardTopic, durationKey);
          
          if (!rawChapters || rawChapters.length === 0) {
              throw new Error("Failed to generate script outline. Please try again.");
          }
          
          setStatus({ step: 'refining', progress: 8, message: `Auditing Outline for Monetization & Facts...` });
          const chapters = await auditStoryOutline(rawChapters, wizardTopic);
          
          const finalChapters = (chapters && chapters.length > 0) ? chapters : (rawChapters || []);
          
          const fullOutline = (finalChapters || []).map(c => `${c.title} (${c.wordCount} words): ${c.description}`).join('\n');
          let rawFullScript = "";
          let previousSummary = "Start";
          for (let i = 0; i < finalChapters.length; i++) {
              setStatus({ step: 'refining', progress: Math.round(((i + 1) / finalChapters.length) * 100), message: `Writing Viral Part ${i + 1}/${finalChapters.length}...` });
              const { content, summary } = await generateStoryChapter(wizardTopic, finalChapters[i], previousSummary, fullOutline, i + 1, finalChapters.length, durationKey);
              rawFullScript += `\n\n${content}`;
              previousSummary = summary;
          }
          const { auditedScript } = await masterAuditScript(rawFullScript, wizardTopic);
          
          // Clean up any remaining labels just in case
          const cleanedScript = auditedScript
            .replace(/\[Introduction\]/gi, '')
            .replace(/\[Chapter \d+\]/gi, '')
            .replace(/Narrator:/gi, '')
            .replace(/Visuals:.*$/gm, '')
            .replace(/Scene:.*$/gm, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          setProject(prev => ({ ...prev, scriptText: cleanedScript, videoTitle: wizardTopic }));
          
          // 2. Generate Scenes First (so we can do per-scene audio sync)
          setStatus({ step: 'generating_scenes', progress: 10, message: 'Step 2: Analyzing Script for Scenes...' });
          const initialScenes = await generateScenes(auditedScript, 600); // 600 is dummy duration
          
          // 3. Generate Voice Over per scene for perfect sync
          setStatus({ step: 'refining', progress: 0, message: 'Step 3: Synthesizing Narration & Syncing...' });
          const { masterAudioBlob, updatedScenes, audioDuration } = await generateVoiceOverForScenes(
              initialScenes, 
              project.ttsVoice, 
              (p, m) => setStatus({ step: 'refining', progress: p, message: m })
          );
          
          const audioFile = new File([masterAudioBlob], "master_narration.wav", { type: "audio/wav" });
          const audioUrl = URL.createObjectURL(audioFile);
          
          setProject(prev => ({ ...prev, audioFile, audioDuration, scenes: updatedScenes, visualStage: 'scenes' }));
          setAudioUrl(audioUrl);
          
          setStatus({ step: 'generating_image_prompts', progress: 30, message: 'Step 4: Generating Image Prompts...' });

          // 4. Generate Image Prompts
          const imagePrompts = await generateImagePrompts(updatedScenes || []);
          const scenesWithImagePrompts = (updatedScenes || []).map((s, i) => ({ ...s, imagePrompt: imagePrompts[i] || s.visualDescription }));
          setProject(prev => ({ ...prev, scenes: scenesWithImagePrompts, visualStage: 'image_prompts' }));
          setStatus({ step: 'generating_video_prompts', progress: 50, message: 'Step 5: Generating Video Prompts...' });

          // 5. Generate Video Prompts
          const videoPrompts = await generateVideoPrompts(scenesWithImagePrompts);
          const scenesWithAllPrompts = (scenesWithImagePrompts || []).map((s, i) => ({ ...s, videoPrompt: videoPrompts[i] || "Cinematic motion." }));
          setProject(prev => ({ ...prev, scenes: scenesWithAllPrompts, visualStage: 'video_prompts' }));
          
          // 6 & 7. Batch Render Visuals
          setStatus({ step: 'generating_images', progress: 70, message: 'Step 6: Starting Batch Visual Render...' });
          await autoBatchRender(scenesWithAllPrompts);

      } catch (e: any) {
          console.error("Automated Pipeline Error:", e);
          setStatus({ step: 'idle', progress: 0, message: `Automated Pipeline Failed: ${e.message || 'Unknown error'}` });
      }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setStatus({ step: 'refining', progress: 10, message: 'Processing & Trimming Silence...' });
    try {
        const cleanedBlob = await trimSilenceFromAudio(file);
        const cleanedFile = new File([cleanedBlob], "cleaned_narration.wav", { type: "audio/wav" });
        const url = URL.createObjectURL(cleanedFile);
        
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          setProject(prev => ({ ...prev, audioFile: cleanedFile, audioDuration: audio.duration }));
          setAudioUrl(url);
          setStatus({ step: 'ready', progress: 100, message: 'Audio Uploaded & Tightened.' });
        };
    } catch (err) {
        setStatus({ step: 'idle', progress: 0, message: 'Audio Processing Failed.' });
    }
  };

  const handleOverlayUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setProject(prev => ({ ...prev, vaporOverlayFile: file, enableVaporOverlay: true }));
  };

  const handleAuditScript = async () => {
      if (!project.scriptText) return;
      setStatus({ step: 'refining', progress: 50, message: 'Auditing Viral Script...' });
      try {
          const { auditedScript, changesLog } = await masterAuditScript(project.scriptText, project.videoTitle || wizardTopic || 'Documentary');
          setProject(prev => ({ ...prev, scriptText: auditedScript }));
          alert(`Master Audit Complete!\n\n${changesLog}`);
          setStatus({ step: 'ready', progress: 100, message: 'Audit Applied.' });
      } catch (e) {
          setStatus({ step: 'idle', progress: 0, message: 'Audit Failed.' });
      }
  };

  const handleGenerateVoice = async () => {
      if (!project.scriptText) return null;
      try {
          setStatus({ step: 'refining', progress: 0, message: 'Synthesizing Narration...' });
          const cleanedWavBlob = await generateVoiceOver(project.scriptText, project.ttsVoice, (p, m) => setStatus({ step: 'refining', progress: p, message: m }));
          const file = new File([cleanedWavBlob], "master_narration.wav", { type: "audio/wav" });
          const url = URL.createObjectURL(file);
          return new Promise<{url: string, duration: number}>((resolve) => {
              const audio = new Audio(url);
              audio.onloadedmetadata = () => {
                setProject(prev => ({ ...prev, audioFile: file, audioDuration: audio.duration }));
                setAudioUrl(url);
                setStatus({ step: 'ready', progress: 100, message: 'Tightened Narration Ready.' });
                resolve({url, duration: audio.duration});
              };
          });
      } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Synthesis Failed.' }); return null; }
  };

  const handleStartFullProduction = async () => {
      if(!wizardTopic) return;
      setShowScriptWizard(false);
      setStatus({ step: 'refining', progress: 5, message: 'Architecting Landmarks & Stops...' });
      try {
          const durationKey = await determineScriptFramework(wizardTopic);
          
          console.log("Generating outline for:", wizardTopic);
          const rawChapters = await generateStoryOutline(wizardTopic, durationKey);
          if (!rawChapters || rawChapters.length === 0) {
              throw new Error("Failed to generate script outline.");
          }
          console.log("Raw Chapters:", rawChapters);

          setStatus({ step: 'refining', progress: 8, message: `Auditing Outline for Monetization & Facts...` });
          const chapters = await auditStoryOutline(rawChapters, wizardTopic);
          
          const finalChapters = (chapters && chapters.length > 0) ? chapters : (rawChapters || []);
          console.log("Final Chapters:", finalChapters);

          const fullOutline = (finalChapters || []).map(c => `${c.title} (${c.wordCount} words): ${c.description}`).join('\n');
          let rawFullScript = "";
          let previousSummary = "Start";
          for (let i = 0; i < finalChapters.length; i++) {
              setStatus({ step: 'refining', progress: Math.round(((i + 1) / finalChapters.length) * 100), message: `Writing Viral Part ${i + 1}/${finalChapters.length}...` });
              const { content, summary } = await generateStoryChapter(wizardTopic, finalChapters[i], previousSummary, fullOutline, i + 1, finalChapters.length, durationKey);
              rawFullScript += `\n\n${content}`;
              previousSummary = summary;
          }
          console.log("Raw Full Script Length:", rawFullScript.length);
          const { auditedScript } = await masterAuditScript(rawFullScript, wizardTopic);
          console.log("Audited Script Length:", auditedScript.length);
          
          // Clean up any remaining labels just in case
          const cleanedScript = auditedScript
            .replace(/\[Introduction\]/gi, '')
            .replace(/\[Chapter \d+\]/gi, '')
            .replace(/Narrator:/gi, '')
            .replace(/Visuals:.*$/gm, '')
            .replace(/Scene:.*$/gm, '')
            .replace(/\[.*?\]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          setProject(prev => ({ ...prev, scriptText: cleanedScript, videoTitle: wizardTopic, visualStage: 'idle' }));
          setStatus({ step: 'ready', progress: 100, message: 'Script Generated & Audited.' });
      } catch (e: any) { 
          console.error("Production Error:", e);
          setStatus({ step: 'idle', progress: 0, message: `Production Error: ${e.message || 'Unknown error'}` }); 
      }
  };

  const runGenerateScenes = async () => {
    if (!project.scriptText) return;
    setStatus({ step: 'generating_scenes', progress: 10, message: 'Analyzing Script for Scenes...' });
    try {
      // 1. Generate Scenes
      const initialScenes = await generateScenes(project.scriptText, project.audioDuration || 600);
      
      let finalScenes = initialScenes;
      
      // If no audio exists, OR if the audio was previously generated by us, generate it now for perfect sync
      if (!project.audioFile || project.audioFile.name === "master_narration.wav") {
          setStatus({ step: 'refining', progress: 0, message: 'Synthesizing Narration & Syncing...' });
          const { masterAudioBlob, updatedScenes, audioDuration } = await generateVoiceOverForScenes(
              initialScenes, 
              project.ttsVoice, 
              (p, m) => setStatus({ step: 'refining', progress: p, message: m })
          );
          
          const audioFile = new File([masterAudioBlob], "master_narration.wav", { type: "audio/wav" });
          const audioUrl = URL.createObjectURL(audioFile);
          
          setProject(prev => ({ ...prev, audioFile, audioDuration }));
          setAudioUrl(audioUrl);
          finalScenes = updatedScenes;
      }
      
      setProject(prev => ({ ...prev, scenes: finalScenes, visualStage: 'scenes' }));
      setStatus({ step: 'generating_image_prompts', progress: 30, message: `${finalScenes.length} Scenes Generated. Starting Image Prompts...` });

      // 2. Generate Image Prompts
      const imagePrompts = await generateImagePrompts(finalScenes || []);
      const scenesWithImagePrompts = (finalScenes || []).map((s, i) => ({ ...s, imagePrompt: imagePrompts[i] || s.visualDescription }));
      setProject(prev => ({ ...prev, scenes: scenesWithImagePrompts, visualStage: 'image_prompts' }));
      setStatus({ step: 'generating_video_prompts', progress: 50, message: 'Image Prompts Ready. Starting Video Prompts...' });

      // 3. Generate Video Prompts
      const videoPrompts = await generateVideoPrompts(scenesWithImagePrompts);
      const scenesWithAllPrompts = (scenesWithImagePrompts || []).map((s, i) => ({ ...s, videoPrompt: videoPrompts[i] || "Cinematic motion." }));
      setProject(prev => ({ ...prev, scenes: scenesWithAllPrompts, visualStage: 'video_prompts' }));
      setStatus({ step: 'generating_images', progress: 70, message: 'Prompts Ready. Starting Batch Visual Render...' });

      // 4. Auto-Start Batch Rendering (Images & Videos)
      // We'll trigger image rendering first, then video rendering
      // Note: We need to use the LATEST scenesWithAllPrompts for this, so we pass them directly or update state first.
      // Since state updates are async, we'll call a modified batch function or just trigger the existing logic 
      // but we need to be careful about state. Ideally, we should wait for state to settle or pass data.
      // For simplicity in this "Senior Engineer" refactor, we will chain the batch operations using the data we have.
      
      await autoBatchRender(scenesWithAllPrompts);

    } catch (e) { 
        console.error(e);
        setStatus({ step: 'idle', progress: 0, message: 'Automatic Pipeline Failed.' }); 
    }
  };

  const autoBatchRender = async (scenesToRender: Scene[]) => {
      // This function mimics handleBatchRenderImages + handleBatchRenderVideos but uses the passed scenes
      // to avoid stale state issues during the auto-chain.
      
      // A. Render Images
      const imageIndices = (scenesToRender || []).map((s, i) => (s.assetType === 'image' || s.assetType === 'video') ? i : -1).filter(i => i !== -1);
      let scenesAfterImages = [...(scenesToRender || [])];
      
      if (imageIndices.length > 0) {
          setStatus({ step: 'generating_images', progress: 70, message: `Auto-Rendering ${imageIndices.length} Base Images...` });
          const BATCH_SIZE = 3;
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          const getJitter = (min = 500, max = 2000) => Math.floor(Math.random() * (max - min + 1)) + min;

          for (let i = 0; i < imageIndices.length; i += BATCH_SIZE) {
              const batch = imageIndices.slice(i, i + BATCH_SIZE);
              await Promise.all(batch.map(async (index) => {
                  await delay(getJitter(200, 1500));
                  try {
                      const scene = scenesAfterImages[index];
                      const prompt = scene.imagePrompt || scene.visualDescription;
                      const base64 = await generateImageForScene(prompt, project.aspectRatio);
                      scenesAfterImages[index] = { ...scenesAfterImages[index], imageUrl: base64 };
                      
                      // Update UI incrementally
                      setProject(prev => {
                          const newScenes = [...prev.scenes];
                          newScenes[index] = scenesAfterImages[index];
                          return { ...prev, scenes: newScenes };
                      });
                  } catch (e) { console.error(e); }
              }));
              if (i + BATCH_SIZE < imageIndices.length) await delay(getJitter(1000, 2500));
          }
      }

      // B. Render Videos (for scenes marked as 'video')
      const videoIndices = (scenesAfterImages || []).map((s, i) => (s.assetType === 'video') ? i : -1).filter(i => i !== -1);
      
      if (videoIndices.length > 0) {
          setStatus({ step: 'generating_videos', progress: 85, message: `Auto-Rendering ${videoIndices.length} Video Clips...` });
          const BATCH_SIZE = 2;
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          const getJitter = (min = 500, max = 2000) => Math.floor(Math.random() * (max - min + 1)) + min;

          for (let i = 0; i < videoIndices.length; i += BATCH_SIZE) {
              const batch = videoIndices.slice(i, i + BATCH_SIZE);
              await Promise.all(batch.map(async (index) => {
                  await delay(getJitter(500, 2000));
                  try {
                      const scene = scenesAfterImages[index];
                      if (!scene.imageUrl) return; // Should have been generated in step A
                      
                      const prompt = scene.videoPrompt || "Cinematic motion.";
                      const videoUrl = await generateVideoForScene(prompt, scene.imageUrl);
                      scenesAfterImages[index] = { ...scenesAfterImages[index], videoUrl };

                      // Update UI incrementally
                      setProject(prev => {
                          const newScenes = [...prev.scenes];
                          newScenes[index] = scenesAfterImages[index];
                          return { ...prev, scenes: newScenes };
                      });
                  } catch (e) { console.error(e); }
              }));
              if (i + BATCH_SIZE < videoIndices.length) await delay(getJitter(2000, 4000));
          }
      }

      setStatus({ step: 'ready', progress: 100, message: 'Full Automatic Production Complete!' });
  };

  const runGenerateImagePrompts = async () => {
    if (project.scenes.length === 0) return;
    setStatus({ step: 'generating_image_prompts', progress: 50, message: 'Generating Detailed Image Prompts...' });
    try {
      const prompts = await generateImagePrompts(project.scenes);
      setProject(prev => ({
        ...prev,
        visualStage: 'image_prompts',
        scenes: (prev.scenes || []).map((s, i) => ({ ...s, imagePrompt: prompts[i] || s.visualDescription }))
      }));
      setStatus({ step: 'ready', progress: 100, message: 'Image Prompts Generated.' });
    } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Prompt Generation Failed.' }); }
  };

  const runGenerateVideoPrompts = async () => {
    if (project.scenes.length === 0) return;
    setStatus({ step: 'generating_video_prompts', progress: 50, message: 'Generating Cinematic Video Prompts...' });
    try {
      const prompts = await generateVideoPrompts(project.scenes);
      setProject(prev => ({
        ...prev,
        visualStage: 'video_prompts',
        scenes: (prev.scenes || []).map((s, i) => ({ ...s, videoPrompt: prompts[i] || "Cinematic motion." }))
      }));
      setStatus({ step: 'ready', progress: 100, message: 'Video Prompts Generated.' });
    } catch (e) { setStatus({ step: 'idle', progress: 0, message: 'Video Prompt Generation Failed.' }); }
  };

  const handleBulkImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setStatus({ step: 'generating_images', progress: 0, message: `Importing Assets...` });
      const fileList = (Array.from(files) as File[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const imageData: string[] = [];
      for (let i = 0; i < fileList.length; i++) {
          const base64 = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(fileList[i]);
          });
          imageData.push(base64);
          if (i % 5 === 0) setStatus({ step: 'generating_images', progress: Math.round(((i + 1) / fileList.length) * 100), message: `Processing Image ${i+1}/${fileList.length}...` });
      }
      setProject(prev => {
          if (prev.scenes.length === 0) { alert("Generate storyboard first."); return prev; }
          const updatedScenes = (prev.scenes || []).map((scene, i) => i < imageData.length ? { ...scene, imageUrl: imageData[i] } : scene);
          return { ...prev, scenes: updatedScenes };
      });
      setStatus({ step: 'ready', progress: 100, message: 'Import Complete!' });
  };

  const handleBulkVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setStatus({ step: 'importing_assets', progress: 0, message: `Mapping Video Clips...` });
      const fileList = (Array.from(files) as File[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      setProject(prev => {
          if (prev.scenes.length === 0) { alert("Please generate scenes first."); return prev; }
          const updatedScenes = (prev.scenes || []).map((scene, i) => {
              if (i < fileList.length) {
                  return { ...scene, videoClipUrl: URL.createObjectURL(fileList[i]) };
              }
              return scene;
          });
          return { ...prev, scenes: updatedScenes };
      });
      setStatus({ step: 'ready', progress: 100, message: 'Video Clips Mapped!' });
  };

  const handleUpdateScene = (id: string, updates: Partial<Scene>) => {
    setProject(prev => ({
      ...prev,
      scenes: (prev.scenes || []).map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const handleRetryScene = async (sceneId: string, customPrompt: string) => {
    const sceneIdx = project.scenes.findIndex(s => s.id === sceneId);
    if (sceneIdx === -1) return;
    const updatedScenes = [...project.scenes];
    updatedScenes[sceneIdx] = { ...updatedScenes[sceneIdx], isGeneratingImage: true };
    setProject(prev => ({ ...prev, scenes: updatedScenes }));
    try {
      const base64 = await generateImageForScene(customPrompt, project.aspectRatio);
      handleUpdateScene(sceneId, { imageUrl: base64, isGeneratingImage: false });
    } catch (e) { 
      handleUpdateScene(sceneId, { isGeneratingImage: false });
    }
  };

  const handleRetryVideo = async (sceneId: string, customPrompt: string) => {
    const sceneIdx = project.scenes.findIndex(s => s.id === sceneId);
    if (sceneIdx === -1) return;
    
    const scene = project.scenes[sceneIdx];
    if (!scene.imageUrl) {
        alert("Generate an image first to use as reference for video.");
        return;
    }

    const updatedScenes = [...project.scenes];
    updatedScenes[sceneIdx] = { ...updatedScenes[sceneIdx], isGeneratingVideo: true };
    setProject(prev => ({ ...prev, scenes: updatedScenes }));
    
    try {
      const videoUrl = await generateVideoForScene(customPrompt, scene.imageUrl);
      handleUpdateScene(sceneId, { videoUrl, isGeneratingVideo: false });
    } catch (e) { 
      handleUpdateScene(sceneId, { isGeneratingVideo: false });
    }
  };

  const handleBatchRenderImages = async () => {
    if (project.scenes.length === 0) return;
    
    // Identify indices of scenes that need processing
    const indicesToProcess = (project.scenes || [])
        .map((s, i) => (s.assetType === 'image' && !s.imageUrl) ? i : -1)
        .filter(i => i !== -1);

    if (indicesToProcess.length === 0) {
        alert("No scenes marked as 'image' need rendering.");
        return;
    }

    let completedCount = 0;
    setStatus({ step: 'generating_images', progress: 0, message: `Starting Smart Batch Render of ${indicesToProcess.length} Image Scenes...` });
    
    // BATCH SIZE: 3 concurrent requests (Safe for paid tiers, avoids 429 errors)
    const BATCH_SIZE = 3;
    
    // Helper for delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const getJitter = (min = 500, max = 2000) => Math.floor(Math.random() * (max - min + 1)) + min;

    for (let i = 0; i < indicesToProcess.length; i += BATCH_SIZE) {
        const batch = indicesToProcess.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (index) => {
            // Apply jitter to stagger requests within the batch
            await delay(getJitter(200, 1500));
            
            try {
                const scene = project.scenes[index]; 
                const prompt = scene.imagePrompt || scene.visualDescription;
                
                const base64 = await generateImageForScene(prompt, project.aspectRatio);
                
                setProject(prev => {
                    const newScenes = [...prev.scenes];
                    if (newScenes[index].id === scene.id) {
                        newScenes[index] = { ...newScenes[index], imageUrl: base64 };
                    }
                    return { ...prev, scenes: newScenes };
                });

                completedCount++;
                setStatus({ 
                    step: 'generating_images', 
                    progress: Math.round((completedCount / indicesToProcess.length) * 100), 
                    message: `Rendering Images... (${completedCount}/${indicesToProcess.length})` 
                });

            } catch (e) {
                console.error(`Failed to render image for scene ${index}:`, e);
                completedCount++; 
                setStatus({ 
                    step: 'generating_images', 
                    progress: Math.round((completedCount / indicesToProcess.length) * 100), 
                    message: `Rendering Images... (${completedCount}/${indicesToProcess.length}) - Errors occurred` 
                });
            }
        }));
        
        // Cool-down between batches
        if (i + BATCH_SIZE < indicesToProcess.length) {
             await delay(getJitter(1000, 2500));
        }
    }

    setStatus({ step: 'ready', progress: 100, message: 'Batch Image Render Complete!' });
  };

  const handleBatchRenderVideos = async () => {
    if (project.scenes.length === 0) return;
    
    const indicesToProcess = (project.scenes || [])
        .map((s, i) => (s.assetType === 'video' && !s.videoUrl) ? i : -1)
        .filter(i => i !== -1);

    if (indicesToProcess.length === 0) {
        alert("No scenes marked as 'video' need rendering.");
        return;
    }

    let successCount = 0;
    let failCount = 0;
    let completedCount = 0;

    setStatus({ step: 'generating_videos', progress: 0, message: `Starting Smart Batch Video Render of ${indicesToProcess.length} Video Scenes...` });
    
    // BATCH SIZE: 2 concurrent requests (Video generation is heavy, safer to limit)
    const BATCH_SIZE = 2;
    
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const getJitter = (min = 500, max = 2000) => Math.floor(Math.random() * (max - min + 1)) + min;

    for (let i = 0; i < indicesToProcess.length; i += BATCH_SIZE) {
        const batch = indicesToProcess.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (index) => {
            // Apply jitter
            await delay(getJitter(500, 2000));

            try {
                const scene = project.scenes[index];
                
                let refImage = scene.imageUrl;
                if (!refImage) {
                    const imgPrompt = scene.imagePrompt || scene.visualDescription;
                    refImage = await generateImageForScene(imgPrompt, project.aspectRatio);
                    
                    setProject(prev => {
                        const newScenes = [...prev.scenes];
                        if (newScenes[index].id === scene.id) {
                            newScenes[index] = { ...newScenes[index], imageUrl: refImage };
                        }
                        return { ...prev, scenes: newScenes };
                    });
                }

                const prompt = scene.videoPrompt || "Cinematic motion on white background.";
                const videoUrl = await generateVideoForScene(prompt, refImage!);
                
                setProject(prev => {
                    const newScenes = [...prev.scenes];
                    if (newScenes[index].id === scene.id) {
                        newScenes[index] = { ...newScenes[index], videoUrl: videoUrl };
                    }
                    return { ...prev, scenes: newScenes };
                });

                successCount++;
            } catch (e) {
                console.error(`Failed to render video for scene ${index}:`, e);
                failCount++;
            } finally {
                completedCount++;
                setStatus({ 
                    step: 'generating_videos', 
                    progress: Math.round((completedCount / indicesToProcess.length) * 100), 
                    message: `Rendering Videos... (${completedCount}/${indicesToProcess.length}) - Success: ${successCount}, Fail: ${failCount}` 
                });
            }
        }));

        // Cool-down between batches
        if (i + BATCH_SIZE < indicesToProcess.length) {
             await delay(getJitter(2000, 4000));
        }
    }

    setStatus({ step: 'ready', progress: 100, message: `Batch Video Render Complete! (${successCount} succeeded, ${failCount} failed)` });
  };

  const downloadAllImages = async () => {
    if (project.scenes.length === 0) return;
    const imagesToDownload = project.scenes.filter(s => s.imageUrl);
    if (imagesToDownload.length === 0) {
        alert("No images generated yet.");
        return;
    }

    setStatus({ step: 'refining', progress: 0, message: `Zipping ${imagesToDownload.length} Images...` });
    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    
    for (let i = 0; i < imagesToDownload.length; i++) {
        const scene = imagesToDownload[i];
        if (scene.imageUrl!.startsWith('data:image')) {
            const base64Data = scene.imageUrl!.split(',')[1];
            const mimeType = scene.imageUrl!.split(',')[0].split(':')[1].split(';')[0];
            const extension = mimeType.split('/')[1] || 'png';
            imgFolder?.file(`scene_${i + 1}.${extension}`, base64Data, { base64: true });
        } else if (scene.imageUrl!.startsWith('http')) {
            try {
                const response = await fetch(`/api/proxy/image?url=${encodeURIComponent(scene.imageUrl!)}`);
                const blob = await response.blob();
                imgFolder?.file(`scene_${i + 1}.png`, blob);
            } catch (e) {
                console.error(`Failed to fetch image for scene ${i + 1}`, e);
            }
        }
        setStatus({ step: 'refining', progress: Math.round((i / imagesToDownload.length) * 100), message: `Adding Image ${i + 1}/${imagesToDownload.length} to ZIP...` });
    }
    
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${project.videoTitle || 'master'}_images.zip`);
    setStatus({ step: 'ready', progress: 100, message: 'Images Downloaded!' });
  };

  const downloadMasterAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${project.videoTitle || 'master'}_narration.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExportSceneList = () => {
    if (project.scenes.length === 0) return;
    const data = JSON.stringify(project.scenes, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.videoTitle || 'master'}_scenes.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportSceneList = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const scenes = JSON.parse(event.target?.result as string) as Scene[];
        if (Array.isArray(scenes)) {
          setProject(prev => ({ 
            ...prev, 
            scenes,
            visualStage: scenes.some(s => s.videoPrompt) ? 'video_prompts' : 
                         scenes.some(s => s.imagePrompt) ? 'image_prompts' : 
                         'scenes'
          }));
          setStatus({ step: 'ready', progress: 100, message: `Imported ${scenes.length} scenes.` });
        }
      } catch (err) {
        alert("Invalid scene list file.");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const downloadPrompts = (type: 'image' | 'video') => {
    let content = "";
    const title = project.videoTitle || 'master';
    
    project.scenes.forEach((s) => {
      const rawPrompt = type === 'image' ? (s.imagePrompt || s.visualDescription) : (s.videoPrompt || "");
      if (rawPrompt) {
        const cleanPrompt = rawPrompt.replace(/^(\d+[\.\:\)\s-]*|#\d+[\.\:\)\s-]*|Scene\s+\d+[\.\:\)\s-]*)/i, '').trim();
        content += `${cleanPrompt}\n`;
      }
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}_${type}_prompts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center font-sans">
        <div className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-2xl max-w-md w-full">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded bg-brand-500 flex items-center justify-center font-bold text-white text-xl">R</div>
            <h1 className="text-2xl font-bold tracking-tight text-white">RMagine <span className="text-brand-400">Master</span></h1>
          </div>
          <p className="text-gray-400 text-center mb-6 text-sm">Please enter the access password to continue.</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            // In a real app, this would be an environment variable like import.meta.env.VITE_APP_PASSWORD
            // For this setup, we check against a hardcoded string or env var
            const correctPassword = (import.meta as any).env.VITE_APP_PASSWORD || 'VideoMaker2026!';
            if (passwordInput === correctPassword) {
              setIsAuthenticated(true);
            } else {
              alert('Incorrect password');
              setPasswordInput('');
            }
          }} className="space-y-4">
            <input 
              type="password" 
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter password..."
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-4 text-white focus:border-brand-500 outline-none transition-colors"
              autoFocus
            />
            <button 
              type="submit"
              className="w-full bg-brand-600 hover:bg-brand-500 text-white font-bold py-4 rounded-lg transition-colors shadow-lg"
            >
              Unlock Application
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans overflow-hidden">
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-brand-500 flex items-center justify-center font-bold">R</div>
            <h1 className="text-xl font-bold tracking-tight">RMagine <span className="text-brand-400">Master</span></h1>
          </div>
          <div className="text-xs text-brand-400 font-mono bg-gray-800/50 px-3 py-1.5 rounded-full border border-gray-700">
              VIRAL PIPELINE ACTIVE
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col lg:flex-row gap-8 overflow-hidden">
        <div className="lg:w-1/3 flex flex-col gap-6 overflow-y-auto h-full pr-2 scrollbar-hide">
          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-brand-400 flex items-center justify-between">
              1. Script & Narration
              {audioUrl && (
                <button onClick={downloadMasterAudio} className="text-[10px] bg-amber-600/20 text-amber-400 px-3 py-1 rounded-full border border-amber-600/50 hover:bg-amber-600 hover:text-white transition-all">
                  DOWNLOAD MASTER AUDIO
                </button>
              )}
            </h2>
            <textarea value={project.scriptText} onChange={(e) => setProject(prev => ({ ...prev, scriptText: e.target.value }))} className="w-full bg-gray-950 border border-gray-800 rounded p-4 text-sm h-48 focus:border-brand-500 outline-none" placeholder="Script will appear here..." />
            
            <div className="space-y-2">
              <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">OpenAI Voice Selection</label>
              <div className="grid grid-cols-3 gap-1">
                {(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const).map(v => (
                  <button 
                    key={v} 
                    onClick={() => setProject(p => ({...p, ttsVoice: v}))}
                    className={`py-1.5 rounded text-[9px] font-bold border transition-all ${project.ttsVoice === v ? 'bg-brand-600 border-brand-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                  >
                    {v.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowScriptWizard(true)} className="py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] font-bold transition-all">START DOC WRITER</button>
              <button onClick={() => audioInputRef.current?.click()} className="py-2 bg-gray-800 hover:bg-gray-700 rounded text-[10px] font-bold border border-gray-700 transition-colors">UPLOAD AUDIO</button>
              <input type="file" ref={audioInputRef} className="hidden" accept="audio/*" onChange={handleAudioUpload} />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={handleGenerateVoice} disabled={!project.scriptText} className="py-2 bg-brand-600 hover:bg-brand-500 rounded text-[10px] font-bold disabled:opacity-50">GENERATE AI NARRATION</button>
            </div>
          </section>

          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-amber-400">2. Visual Master Production</h2>
            <div className="flex flex-col gap-3">
                <button 
                  onClick={runGenerateScenes} 
                  disabled={!project.scriptText || project.visualStage !== 'idle'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'idle' ? 'bg-indigo-700 hover:bg-indigo-600' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.scenes.length > 0 ? `Stage 1: ${project.scenes.length} Scenes Created` : "STAGE 1: GENERATE SCENES"}
                </button>

                <button 
                  onClick={runGenerateImagePrompts} 
                  disabled={project.scenes.length === 0 || project.visualStage === 'idle' || project.visualStage === 'video_prompts'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'scenes' ? 'bg-indigo-700 hover:bg-indigo-600' : project.visualStage === 'image_prompts' || project.visualStage === 'video_prompts' ? 'bg-emerald-900 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.visualStage === 'image_prompts' || project.visualStage === 'video_prompts' ? "Stage 2: Image Prompts Ready" : "STAGE 2: GENERATE IMAGE PROMPTS"}
                </button>

                <button 
                  onClick={runGenerateVideoPrompts} 
                  disabled={project.visualStage !== 'image_prompts'} 
                  className={`w-full py-3 rounded-lg text-xs font-bold transition-all ${project.visualStage === 'image_prompts' ? 'bg-indigo-700 hover:bg-indigo-600' : project.visualStage === 'video_prompts' ? 'bg-emerald-900 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}
                >
                  {project.visualStage === 'video_prompts' ? "Stage 3: Video Prompts Ready" : "STAGE 3: GENERATE VIDEO PROMPTS"}
                </button>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={() => downloadPrompts('image')} disabled={project.scenes.length === 0} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-brand-400">DOWNLOAD IMAGE PROMPTS</button>
                  <button onClick={() => downloadPrompts('video')} disabled={project.visualStage !== 'video_prompts'} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-amber-400">DOWNLOAD VIDEO PROMPTS</button>
                </div>
                
                <div className="grid grid-cols-1 gap-2 mt-2">
                  <button onClick={downloadAllImages} disabled={!project.scenes.some(s => s.imageUrl)} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-pink-400">DOWNLOAD ALL IMAGES (ZIP)</button>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={handleExportSceneList} disabled={project.scenes.length === 0} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-emerald-400">EXPORT SCENE LIST</button>
                  <button onClick={() => sceneImportInputRef.current?.click()} className="py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-[10px] font-bold text-blue-400">IMPORT SCENE LIST</button>
                  <input type="file" ref={sceneImportInputRef} className="hidden" accept=".json" onChange={handleImportSceneList} />
                </div>
                
                <div className="pt-2 border-t border-gray-800 flex flex-col gap-2">
                    <button 
                      onClick={handleBatchRenderImages} 
                      disabled={project.scenes.length === 0 || status.step === 'generating_images'} 
                      className="w-full py-3 bg-brand-600 hover:bg-brand-500 rounded-lg text-xs font-bold shadow-lg shadow-brand-500/20"
                    >
                      {status.step === 'generating_images' ? `RENDERING IMAGES... ${status.progress}%` : "BATCH RENDER IMAGE SCENES"}
                    </button>

                    <button 
                      onClick={handleBatchRenderVideos} 
                      disabled={project.scenes.length === 0 || status.step === 'generating_videos'} 
                      className="w-full py-3 bg-amber-600 hover:bg-amber-500 rounded-lg text-xs font-bold shadow-lg shadow-amber-500/20"
                    >
                      {status.step === 'generating_videos' ? `RENDERING VIDEOS... ${status.progress}%` : "BATCH RENDER VIDEO SCENES"}
                    </button>

                    <button onClick={() => bulkImageInputRef.current?.click()} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold">IMPORT IMAGES</button>
                    <input type="file" ref={bulkImageInputRef} multiple className="hidden" accept="image/*" onChange={handleBulkImageUpload} />
                    
                    <button onClick={() => bulkVideoInputRef.current?.click()} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold">IMPORT VIDEO CLIPS</button>
                    <input type="file" ref={bulkVideoInputRef} multiple className="hidden" accept="video/*" onChange={handleBulkVideoUpload} />
                </div>
            </div>
          </section>

          <section className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Cinematic Overlays</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-950 rounded border border-gray-800">
                <span className="text-[10px] font-bold text-gray-500">DYNAMIC EMBERS</span>
                <button onClick={() => setProject(p => ({...p, enableEmbers: !p.enableEmbers}))} className={`px-4 py-1 rounded text-[10px] font-bold transition-all ${project.enableEmbers ? 'bg-orange-600' : 'bg-gray-800'}`}>
                    {project.enableEmbers ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="p-3 bg-gray-950 rounded border border-gray-800 space-y-2">
                <div className="flex justify-between items-center mb-1">
                   <span className="text-[10px] font-bold text-gray-500">VAPOR OVERLAY</span>
                   <button onClick={() => overlayInputRef.current?.click()} className="text-[9px] bg-brand-600 px-2 py-0.5 rounded">UPLOAD</button>
                   <input type="file" ref={overlayInputRef} className="hidden" accept="video/*" onChange={handleOverlayUpload} />
                </div>
                {project.vaporOverlayFile && (
                  <input type="range" min="0" max="1" step="0.05" value={project.vaporOverlayOpacity} onChange={(e) => setProject(p => ({...p, vaporOverlayOpacity: parseFloat(e.target.value)}))} className="w-full h-1 accent-brand-500" />
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="lg:w-2/3 flex flex-col gap-8 overflow-y-auto h-full pb-20 scrollbar-hide">
          {status.message && (
            <div className="bg-brand-900/30 p-4 rounded-lg border border-brand-500/30 flex items-center justify-between text-xs font-mono">
              <span>{status.message}</span>
              <span className="bg-brand-600 px-2 py-0.5 rounded">{status.progress}%</span>
            </div>
          )}
          
          <section className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-2xl">
             <Player 
               audioUrl={audioUrl} scenes={project.scenes} aspectRatio={project.aspectRatio} videoTitle={project.videoTitle} onTimeUpdate={setCurrentTime} setProcessingStatus={setStatus} backgroundAudioFile={project.backgroundAudioFile} backgroundVolume={project.backgroundVolume} enableBackgroundMusic={project.enableBackgroundMusic} enableEmbers={project.enableEmbers} filmGrainStrength={project.filmGrainStrength} enableVaporOverlay={project.enableVaporOverlay} vaporOverlayFile={project.vaporOverlayFile} vaporOverlayOpacity={project.vaporOverlayOpacity} triggerAutoExport={false} onExportStarted={() => {}} onExportComplete={() => {}} isBatchMode={false} fullScript={project.scriptText} 
             />
             <Timeline scenes={project.scenes} audioDuration={project.audioDuration || 60} currentTime={currentTime} onSceneSelect={setSelectedSceneId} selectedSceneId={selectedSceneId} onUpdateSceneTimes={(s) => setProject(prev => ({...prev, scenes: s}))} />
          </section>

          <section className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-xl">
            <h3 className="text-lg font-semibold text-brand-400 mb-6">Production Manager ({project.scenes.length} Scenes)</h3>
            <div className="grid grid-cols-1 gap-6">
              {(project.scenes || []).map((scene, index) => (
                  <SceneEditor 
                    key={scene.id} 
                    scene={scene} 
                    index={index} 
                    stage={project.visualStage}
                    onUpdate={(updates) => handleUpdateScene(scene.id, updates)}
                    onRetry={(prompt) => handleRetryScene(scene.id, prompt)}
                    onRetryVideo={(prompt) => handleRetryVideo(scene.id, prompt)}
                    onPreview={() => {
                      if (status.step !== 'idle' && status.step !== 'ready') return;
                      setPreviewScene(scene);
                    }}
                  />
              ))}
            </div>
          </section>
        </div>
      </main>

      {showScriptWizard && (
          <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-8 shadow-2xl">
                    <div className="space-y-6">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold text-brand-400">Viral Script Architect</h3>
                            <button onClick={() => setShowScriptWizard(false)} className="text-gray-500 hover:text-white">&times;</button>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed italic">Generating a 1,400+ word time-travel journey script.</p>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Topic</label>
                            <input type="text" className="w-full bg-gray-950 border border-gray-700 rounded p-4 text-sm focus:border-brand-500 outline-none" placeholder="e.g. Victorian London..." value={wizardTopic} onChange={(e) => setWizardTopic(e.target.value)} />
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowScriptWizard(false)} className="flex-1 py-3 border border-gray-700 rounded-lg text-sm">Cancel</button>
                            <button onClick={handleAutomatedPipeline} disabled={!wizardTopic} className="flex-1 py-3 bg-brand-600 disabled:opacity-50 rounded-lg font-bold text-sm hover:bg-brand-500 transition-all">START VIRAL PIPELINE</button>
                        </div>
                        <div className="pt-2 border-t border-gray-800">
                            <button onClick={handleStartFullProduction} disabled={!wizardTopic} className="w-full py-2 text-[10px] text-gray-500 hover:text-gray-300 uppercase tracking-widest">Just Generate Script</button>
                        </div>
                    </div>
              </div>
          </div>
      )}
      {previewScene && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-10" onClick={() => setPreviewScene(null)}>
          <button 
            onClick={(e) => { e.stopPropagation(); setPreviewScene(null); }}
            className="absolute top-10 right-10 w-12 h-12 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full text-white text-2xl transition-all z-[110]"
          >
            &times;
          </button>
          {previewScene.videoUrl ? (
            <video src={previewScene.videoUrl} controls autoPlay className="max-w-full max-h-full rounded-xl shadow-2xl border border-gray-800" />
          ) : previewScene.videoClipUrl ? (
            <video src={previewScene.videoClipUrl} controls autoPlay className="max-w-full max-h-full rounded-xl shadow-2xl border border-gray-800" />
          ) : (
            <img src={previewScene.imageUrl} className="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-gray-800" alt="Preview" />
          )}
        </div>
      )}
    </div>
  );
};

const SceneEditor: React.FC<{ 
  scene: Scene; 
  index: number; 
  stage: string;
  onUpdate: (updates: Partial<Scene>) => void;
  onRetry: (prompt: string) => void;
  onRetryVideo: (prompt: string) => void;
  onPreview: () => void; 
}> = ({ scene, index, stage, onUpdate, onRetry, onRetryVideo, onPreview }) => {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden flex flex-col md:flex-row group hover:border-brand-500/50 transition-all">
      <div className="w-full md:w-64 aspect-video bg-black relative cursor-zoom-in overflow-hidden shrink-0" onClick={(scene.imageUrl || scene.videoClipUrl || scene.videoUrl) ? onPreview : undefined}>
        {scene.videoUrl || scene.videoClipUrl ? (
          <div className="relative w-full h-full">
            <video src={scene.videoUrl || scene.videoClipUrl} className="w-full h-full object-cover" muted loop autoPlay />
            <div className="absolute inset-0 bg-brand-500/20 flex items-center justify-center pointer-events-none">
              <span className="bg-brand-600 text-[8px] font-bold px-1.5 py-0.5 rounded text-white uppercase tracking-widest">
                {scene.videoUrl ? 'AI Video' : 'Imported Clip'}
              </span>
            </div>
          </div>
        ) : scene.imageUrl ? (
          <img src={scene.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" alt="Scene" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gray-900 text-[10px] text-gray-600 font-bold uppercase">
            Awaiting Visuals
          </div>
        )}
        <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-[10px] font-bold text-brand-400 border border-gray-800">#{index + 1}</div>
      </div>
      
      <div className="p-5 flex-1 space-y-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest block">Visual Description (Stage 1)</label>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${scene.assetType === 'video' ? 'bg-amber-600/20 text-amber-400' : 'bg-brand-600/20 text-brand-400'}`}>
                {scene.assetType}
              </span>
            </div>
            <textarea 
              value={scene.visualDescription} 
              onChange={(e) => onUpdate({ visualDescription: e.target.value })}
              className="w-full bg-gray-900 border border-gray-800 rounded p-3 text-[10px] focus:border-brand-500 outline-none h-16"
            />
          </div>
          <div className="text-[10px] text-gray-500 font-mono text-right shrink-0">
            {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mb-1 block">Overlay Text</label>
            <textarea 
              value={scene.overlayText || ""} 
              onChange={(e) => onUpdate({ overlayText: e.target.value })}
              className="w-full bg-gray-900 border border-gray-800 rounded p-3 text-[10px] focus:border-brand-500 outline-none h-16"
              placeholder="Text to show on screen..."
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-blue-400 uppercase tracking-widest mb-1 block">Layout</label>
            <select 
              value={scene.layout || "centered"} 
              onChange={(e) => onUpdate({ layout: e.target.value as any })}
              className="w-full bg-gray-900 border border-gray-800 rounded p-2 text-xs focus:border-brand-500 outline-none"
            >
              <option value="centered">Centered</option>
              <option value="split-left">Split Left (Media Left)</option>
              <option value="split-right">Split Right (Media Right)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[9px] font-bold text-brand-400 uppercase tracking-widest mb-1 block">Image Generation Prompt (Stage 2)</label>
          <textarea 
            value={scene.imagePrompt || ""} 
            onChange={(e) => onUpdate({ imagePrompt: e.target.value })}
            className="w-full bg-gray-900/50 border border-indigo-900 rounded p-3 text-[10px] focus:border-brand-500 outline-none h-20 text-indigo-100"
            placeholder="Enter image prompt..."
          />
        </div>

        <div>
          <label className="text-[9px] font-bold text-amber-500 uppercase tracking-widest mb-1 block">Video Motion Prompt (Stage 3)</label>
          <textarea 
            value={scene.videoPrompt || ""} 
            onChange={(e) => onUpdate({ videoPrompt: e.target.value })}
            className="w-full bg-gray-900/50 border border-amber-900/50 rounded p-3 text-[10px] focus:border-brand-500 outline-none h-20 text-amber-100"
            placeholder="Enter video motion prompt..."
          />
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => onRetry(scene.imagePrompt || scene.visualDescription)} 
            disabled={scene.isGeneratingImage} 
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 rounded text-[10px] font-bold transition-all disabled:opacity-50"
          >
            {scene.isGeneratingImage ? 'PRODUCING...' : 'RENDER IMAGE'}
          </button>
          
          {scene.assetType === 'video' && (
            <button 
              onClick={() => onRetryVideo(scene.videoPrompt || "Cinematic motion.")} 
              disabled={scene.isGeneratingVideo || !scene.imageUrl} 
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded text-[10px] font-bold transition-all disabled:opacity-50"
            >
              {scene.isGeneratingVideo ? 'PRODUCING...' : 'RENDER VIDEO'}
            </button>
          )}

          <div className="flex-1 italic text-[9px] text-gray-500 flex items-center">
            "{scene.scriptSegment}"
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
