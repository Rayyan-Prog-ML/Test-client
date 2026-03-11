
import OpenAI from "openai";
import { Scene, AspectRatio, OpenAIVoice, ChapterOutline } from "../types";
import WaveSpeed from 'wavespeed';

const openRouterClient = new OpenAI({
    baseURL: typeof window !== 'undefined' ? `${window.location.origin}/api/openrouter` : '/api/openrouter',
    apiKey: 'PROXY', // The actual key is handled by the server
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
        "HTTP-Referer": "https://aistudio.google.com",
        "X-Title": "Clips Video Production Pipeline",
    }
});

export const STYLE_KEYWORDS = "Minimalist editorial design, pure white background, high-end graphic composition, studio lighting, sharp focus, professional documentary aesthetic. Media is often placed in a floating card with subtle shadows. NO TEXT, NO LABELS, NO LETTERS inside the image itself. Focus on the subject only.";
export const SAFETY_BLOCK = "STRICT YOUTUBE AD POLICY COMPLIANCE: No profanity, nudity, or graphic battlefield gore. Maintain a respectful educational tone. Maintain facts checks. Ensure the language is safe for 'Green Dollar' monetization, avoiding content that promotes dangerous, unhealthy eating habits, or eating disorders.";

/**
 * CONCURRENCY CONTROLLER & JITTER ENGINE
 * Prevents API rate limiting by managing request flow.
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Random jitter between min and max ms to avoid "bot-like" burst patterns
const getJitter = (min = 500, max = 2000) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Executes an array of async tasks with a concurrency limit and dynamic jitter.
 */
async function processInBatches<T>(
    items: T[], 
    batchSize: number, 
    task: (item: T, index: number) => Promise<any>
): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        // Execute the current batch
        await Promise.all(batch.map(async (item, batchIndex) => {
            const globalIndex = i + batchIndex;
            
            // Apply dynamic jitter BEFORE the request to stagger start times
            const jitterTime = getJitter(200, 1500); 
            await delay(jitterTime);
            
            await task(item, globalIndex);
        }));

        // Optional: Small cool-down between batches if needed
        if (i + batchSize < items.length) {
            await delay(getJitter(1000, 2000)); 
        }
    }
}
/**
 * Verifies if the API key is present.
 */
export const verifyApiKeys = async (): Promise<number> => {
    try {
        const response = await fetch('/api/health');
        if (!response.ok) return 0;
        const data = await response.json();
        const keys = data.keys;
        console.log("[DEBUG] API Key Status:", keys);
        
        let count = 0;
        if (keys.OPENROUTER) count++;
        if (keys.OPENAI) count++;
        if (keys.WAVESPEED) count++;
        return count;
    } catch (e) {
        console.error("Failed to verify API keys:", e);
        return 0;
    }
};

/**
 * HIGH-CAPACITY RETRY ENGINE
 */
async function executeWithRetry<T>(
  operation: (client: OpenAI) => Promise<T>, 
  retries = 3
): Promise<T> {
  try {
    return await operation(openRouterClient);
  } catch (error: any) {
    const status = error.status || error.response?.status;
    const isTransient = status === 429 || status >= 500 || !status;

    if (isTransient && retries > 0) {
        const baseDelay = status === 429 ? 5000 : 1000;
        const attemptNumber = 3 - retries;
        const delayMs = Math.min(baseDelay * Math.pow(2, attemptNumber), 45000);
        console.warn(`[OPENROUTER FAIL] Status ${status}. Retrying. Retries left: ${retries}`);
        await new Promise(r => setTimeout(r, delayMs));
        return executeWithRetry(operation, retries - 1);
    }
    throw error;
  }
}

/**
 * Stage 1: Scenes:)
 * Generates scenes with natural documentary pacing (avg 8-12 seconds).
 */
export const generateScenes = async (script: string, totalDuration: number): Promise<Scene[]> => {
  // We want high granularity: roughly one scene per main sentence or key phrase.
  // Assuming average sentence is 4-6 seconds, we target more scenes.
  const targetSceneCount = Math.max(1, Math.ceil(totalDuration / 5)); 

  return await executeWithRetry(async (client) => {
    const response = await client.chat.completions.create({
      model: "google/gemini-2.0-flash-001", 
      messages: [
        {
          role: "system",
          content: `Act as a world-class documentary editor. Analyze the script and break it down into highly granular scenes. 
          Every main sentence or key phrase MUST have its own visual scene.
          
          CRITICAL INSTRUCTIONS:
          1. GRANULARITY: Create a new scene for every significant sentence or phrase. A scene should ideally be between 2 and 6 seconds long. Do not create scenes that are too short (e.g. just 1 or 2 words) unless absolutely necessary for impact. Group related subjects into a single scene if separating them would make the scenes flash by too quickly.
          2. FULL SCRIPT COVERAGE: The combined 'scriptSegment' of all scenes MUST perfectly reconstruct the entire original script, word-for-word. Do not skip any words, and do not overlap words between scenes. Every single word of the script must belong to exactly one scene's 'scriptSegment'.
          3. THE 12-SECOND RULE: NO SINGLE SCENE SHOULD BE LONGER THAN 12 SECONDS.
          4. ASSET SELECTION (1 VIDEO PER TOPIC/TYPE): 
             - Identify the main topics or types being discussed (e.g., Almonds, Walnuts, Pistachios).
             - For EACH main topic/type, select EXACTLY ONE scene to be a 'video'. This video should depict a dynamic process or physical characteristic (e.g., a hammer cracking a hard walnut shell, harvesting, roasting).
             - ALL OTHER scenes for that topic MUST be 'image'.
             - Default to 'image' for everything else.
          4. LAYOUT SELECTION:
             - ALWAYS default to 'centered' for all assets unless there is a specific artistic reason to use 'split-left' or 'split-right'.
             - For 'centered', the media will be a square card in the center, and text will be at the top.
          5. OVERLAY TEXT: Define the exact short, bold text that should appear on screen. This text should be punchy and match the narration. DO NOT use markdown formatting like asterisks (**). Just plain text.
          6. LOOPING: Set 'isLoopable' to true for static background videos.
          7. VISUAL STYLE: Every scene MUST have a static white background. Media will be placed in a large square card on the left with text on the right.
          
          Return the response as a JSON object with a "scenes" array. Each object in the array MUST have the following fields:
          - "scriptSegment": The exact text from the script that this scene covers.
          - "visualDescription": A highly detailed description of what should be shown on screen.
          - "assetType": Either "image" or "video".
          - "layout": Either "centered", "split-left", or "split-right".
          - "overlayText": The short, bold text to display on screen.
          - "isLoopable": Boolean.\``
        },
        {
          role: "user",
          content: `SCRIPT: ${script.substring(0, 60000)}`
        }
      ],
      response_format: { type: "json_object" }
    });

    const text = response.choices[0].message.content || '{"scenes":[]}';
    const data = JSON.parse(text);
    const rawScenes = data.scenes || [];
    
    // Calculate timing based on word count of each segment for "natural" allocation
    const totalWords = rawScenes.reduce((acc: number, s: any) => acc + (s.scriptSegment?.split(/\s+/).length || 0), 0);
    let currentStartTime = 0;

    return rawScenes.map((s: any, i: number) => {
      const wordCount = s.scriptSegment?.split(/\s+/).length || 0;
      const duration = totalWords > 0 ? (wordCount / totalWords) * totalDuration : totalDuration / Math.max(1, rawScenes.length);
      
      const scene: Scene = {
        id: `scene-${i}-${Date.now()}`,
        scriptSegment: s.scriptSegment || '',
        visualDescription: s.visualDescription || '',
        transitionType: s.transitionType || 'standard',
        assetType: s.assetType || 'image',
        layout: s.layout || 'centered',
        overlayText: (s.overlayText || '').replace(/\*\*/g, ''),
        isLoopable: s.isLoopable || false,
        startTime: currentStartTime,
        endTime: currentStartTime + duration,
        isGeneratingImage: false,
        isGeneratingVideo: false
      };
      
      currentStartTime += duration;
      return scene;
    });
  }, 3);
};

/**
 * Stage 2: Image Prompts:)
 */
export const generateImagePrompts = async (scenes: Scene[]): Promise<string[]> => {
  return await executeWithRetry(async (client) => {
    const response = await client.chat.completions.create({
      model: "google/gemini-2.0-flash-001", 
      messages: [
        {
          role: "system",
          content: `Analyze each individual scene and generate highly detailed image prompts for a single, high-quality subject.
          
          CRITICAL INSTRUCTIONS:
          1. NEVER REFUSE A PROMPT: If a scene asks for a "montage", "collage", or something complex, DO NOT output "Do not generate" or "violates instructions". Instead, creatively adapt the prompt to describe a single, cohesive, highly detailed image that captures the essence of the request.
          2. ONE SUBJECT ONLY: Describe exactly ONE central subject or object. NEVER group multiple images or objects into one composition.
          3. NO TEXT: DO NOT include any instructions to render text, labels, or words inside the image. The image must be purely visual.
          4. PURE WHITE BACKGROUND: Every image MUST be on a clean, studio-style white background.
          5. SHARP FOCUS: The subject should be centered and in sharp focus.
          6. VISUAL CONTINUITY: Maintain consistent colors and style across scenes.
          7. Provide only the detailed image prompts for every scene, with no extra explanation.
          
          Return the response as a JSON object with a "prompts" array.`
        },
        {
          role: "user",
          content: `SCENES: ${JSON.stringify(scenes.map(s => s.visualDescription))}`
        }
      ],
      response_format: { type: "json_object" }
    });
    const text = response.choices[0].message.content || '{"prompts":[]}';
    const data = JSON.parse(text);
    return Array.isArray(data.prompts) ? data.prompts : [];
  }, 2);
};

/**
 * Stage 3: Video Prompts:)
 */
export const generateVideoPrompts = async (scenes: Scene[]): Promise<string[]> => {
  const videoScenes = scenes.map((s, i) => ({ scene: s, index: i })).filter(x => x.scene.assetType === 'video');
  
  if (videoScenes.length === 0) {
    return scenes.map(() => "");
  }

  return await executeWithRetry(async (client) => {
    const response = await client.chat.completions.create({
      model: "google/gemini-2.0-flash-001", 
      messages: [
        {
          role: "system",
          content: `Create detailed video generation prompts for each scene.
          
          CRITICAL INSTRUCTIONS:
          1. ONE SUBJECT ONLY: The video must focus on ONE central action or subject.
          2. NO TEXT: DO NOT include any instructions to render text or overlays.
          3. PURE WHITE BACKGROUND: The entire scene must have a static white background.
          4. CAMERA MOTION: Describe smooth camera movement (e.g., 'slow zoom in', 'gentle pan').
          5. CINEMATIC REALISM: High-quality lighting and realistic motion.
          6. Provide only the raw, direct usable prompts, one per scene.
          
          Return the response as a JSON object with a "videoPrompts" array.`
        },
        {
          role: "user",
          content: `SCENES: ${JSON.stringify(videoScenes.map(x => x.scene.imagePrompt || x.scene.visualDescription))}`
        }
      ],
      response_format: { type: "json_object" }
    });
    const text = response.choices[0].message.content || '{"videoPrompts":[]}';
    const data = JSON.parse(text);
    const generatedPrompts = Array.isArray(data.videoPrompts) ? data.videoPrompts : [];
    
    const finalPrompts = new Array(scenes.length).fill("");
    videoScenes.forEach((vs, idx) => {
      finalPrompts[vs.index] = generatedPrompts[idx] || "Cinematic motion.";
    });
    
    return finalPrompts;
  }, 2);
};

/**
 * Image Generation Cluster (Wavespeed.ai Flux-Schnell)
 */
export const generateImageForScene = async (description: string, aspectRatio: AspectRatio): Promise<string> => {
    const finalPrompt = `STYLE: ${STYLE_KEYWORDS} SCENE: ${description}. ${SAFETY_BLOCK}`;
    
    try {
        const response = await fetch("/api/wavespeed/image", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                prompt: finalPrompt,
                aspect_ratio: aspectRatio
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                console.warn("WAVESPEED_API_KEY missing, falling back to Gemini.");
                return await generateImageWithOpenRouter(description, aspectRatio);
            }
            throw new Error(`WAVESPEED_IMAGE_FAILED: ${response.status}`);
        }

        const data = await response.json();
        if (data.output) {
            return data.output;
        }
        
        throw new Error("IMAGE_GENERATION_FAILED_NO_OUTPUT");
    } catch (err) {
        console.error("Wavespeed image generation failed, falling back to Gemini:", err);
        return await generateImageWithOpenRouter(description, aspectRatio);
    }
};

const generateImageWithOpenRouter = async (description: string, aspectRatio: AspectRatio): Promise<string> => {
    console.warn("OpenRouter image generation not supported. Using Pollinations.ai as a free fallback.");
    
    const width = aspectRatio === '16:9' ? 1280 : aspectRatio === '9:16' ? 720 : 1024;
    const height = aspectRatio === '16:9' ? 720 : aspectRatio === '9:16' ? 1280 : 1024;
    
    // For Pollinations, we need to keep the prompt short to avoid URI Too Long errors.
    // We prioritize the actual description over the style/safety blocks.
    const shortStyle = "Minimalist editorial design, pure white background, sharp focus.";
    const truncatedDesc = description.length > 300 ? description.substring(0, 300) : description;
    const finalPrompt = `${shortStyle} SCENE: ${truncatedDesc}`;
    
    const encodedPrompt = encodeURIComponent(finalPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;
    
    let retries = 3;
    while (retries > 0) {
        try {
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`Failed to fetch image from Pollinations: ${response.status}`);
            
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.startsWith("image/")) {
                throw new Error("Pollinations did not return an image");
            }
            
            const blob = await response.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            
            return base64;
        } catch (e) {
            console.error(`Pollinations fallback failed (retries left: ${retries - 1}):`, e);
            retries--;
            if (retries === 0) throw new Error("IMAGE_GENERATION_FAILED");
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error("IMAGE_GENERATION_FAILED");
};

/**
 * Video Generation Cluster (Wavespeed.ai Wan-2.2 I2V)
 */
export const generateVideoForScene = async (prompt: string, imageUrl: string, retries = 2): Promise<string> => {
    const finalPrompt = `STYLE: ${STYLE_KEYWORDS} VIDEO: ${prompt}. ${SAFETY_BLOCK}`;
    
    try {
        const response = await fetch("/api/wavespeed/video", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                prompt: finalPrompt,
                image_url: imageUrl
            })
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error("WAVESPEED_API_KEY_MISSING");
            }
            throw new Error(`WAVESPEED_VIDEO_FAILED: ${response.status}`);
        }

        const data = await response.json();
        if (data.output) {
            return data.output;
        }
        
        throw new Error("VIDEO_GENERATION_FAILED_NO_OUTPUT");
    } catch (err: any) {
        console.error(`Wavespeed video generation failed (Retries left: ${retries}):`, err);
        
        if (retries > 0) {
            const waitTime = 2000 * (3 - retries);
            console.log(`Retrying video generation in ${waitTime}ms...`);
            await new Promise(r => setTimeout(r, waitTime));
            return generateVideoForScene(prompt, imageUrl, retries - 1);
        }
        
        // If it's a timeout or abort, we might want to log more info
        if (err.message && err.message.includes('signal is aborted')) {
            console.warn("Detected request abortion in Wavespeed SDK. This may be due to network instability or internal SDK timeouts.");
        }
        throw err;
    }
};

// Removed manual polling pollVideoTask as SDK handles it

export const masterAuditScript = async (script: string, topic: string): Promise<{ auditedScript: string; changesLog: string }> => {
  const result = await executeWithRetry(async (client) => {
    const response = await client.chat.completions.create({
      model: "google/gemini-2.0-flash-001",
      messages: [
        {
          role: "system",
          content: `You are a professional script editor. Review this long-form documentary script. Identify patches. Topic: ${topic}.
          
          CRITICAL: Ensure the script contains ONLY spoken narration. If you see any labels like "Narrator:", "Visuals:", "[Introduction]", or stage directions, your patches MUST remove them.
          
          Return the response as a JSON object with:
          - "patches": an array of objects with "originalSnippet", "improvedText", and "reason".
          - "summaryOfChanges": a string summary.
          
          [SAFETY]
          ${SAFETY_BLOCK}`
        },
        {
          role: "user",
          content: `Script: ${script}`
        }
      ],
      response_format: { type: "json_object" },
      // @ts-ignore - reasoning might not be in types yet
      reasoning: { enabled: true }
    });
    const text = response.choices[0].message.content || '{"patches":[], "summaryOfChanges":""}';
    return JSON.parse(text);
  }, 2);

  let finalScript = script;
  let log = result.summaryOfChanges;
  result.patches.forEach((patch: any) => {
    if (finalScript.includes(patch.originalSnippet)) {
      finalScript = finalScript.replace(patch.originalSnippet, patch.improvedText);
    }
  });
  return { auditedScript: finalScript || "", changesLog: log || "" };
};

/**
 * SILENCE TRUNCATION ENGINE
 * Removes parts of audio below a threshold to tighten narration.
 */
export const trimSilenceFromAudio = async (blob: Blob): Promise<Blob> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const threshold = 0.015; // Volume threshold
    const minSilenceSamples = sampleRate * 0.4; // 400ms minimum silence to cut
    const paddingSamples = sampleRate * 0.1; // 100ms padding
    
    let isSilent = true;
    let silenceStart = 0;
    const keepSegments: { start: number; end: number }[] = [];
    
    let currentSegmentStart = -1;

    for (let i = 0; i < channelData.length; i++) {
        const amplitude = Math.abs(channelData[i]);
        
        if (amplitude > threshold) {
            if (currentSegmentStart === -1) {
                currentSegmentStart = Math.max(0, i - paddingSamples);
            }
            isSilent = false;
            silenceStart = i;
        } else {
            if (!isSilent && (i - silenceStart) > minSilenceSamples) {
                const end = Math.min(channelData.length, i - minSilenceSamples + paddingSamples);
                keepSegments.push({ start: currentSegmentStart, end });
                currentSegmentStart = -1;
                isSilent = true;
            }
        }
    }
    
    // Add final segment if needed
    if (currentSegmentStart !== -1) {
        keepSegments.push({ start: currentSegmentStart, end: channelData.length });
    }

    if (keepSegments.length === 0) return blob; // Fallback

    const totalSamples = keepSegments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
    const cleanedPcm = new Int16Array(totalSamples);
    let offset = 0;
    
    for (const seg of keepSegments) {
        for (let j = seg.start; j < seg.end; j++) {
            cleanedPcm[offset++] = Math.max(-1, Math.min(1, channelData[j])) * 32767;
        }
    }

    const wavBlob = createWavBlob(cleanedPcm.buffer, sampleRate);
    audioContext.close();
    return wavBlob;
};

const createWavBlob = (pcmBuffer: ArrayBuffer, sampleRate: number): Blob => {
    const byteLength = pcmBuffer.byteLength;
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + byteLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // Bits per sample
    writeStr(36, 'data');
    view.setUint32(40, byteLength, true);

    return new Blob([new Uint8Array(wavHeader), new Uint8Array(pcmBuffer)], { type: 'audio/wav' });
};

export const generateVoiceOverForScenes = async (scenes: Scene[], voice: OpenAIVoice, onProgress: (p: number, m: string) => void): Promise<{ masterAudioBlob: Blob, updatedScenes: Scene[], audioDuration: number }> => {
    onProgress(5, `Starting synthesis of ${scenes.length} scenes...`);
    
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const pcmBuffers: Int16Array[] = [];
    const updatedScenes: Scene[] = [];
    let currentStartTime = 0;
    let completedCount = 0;

    const fetchSceneAudio = async (scene: Scene, index: number): Promise<void> => {
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                const text = scene.scriptSegment.replace(/[*_#~`]/g, '').trim();
                if (!text) {
                    // Empty scene text, just skip audio generation for this scene
                    (scene as any)._pcm = null;
                    (scene as any)._duration = 2; // 2s default
                    completedCount++;
                    const progress = Math.round(10 + (80 * completedCount / scenes.length));
                    onProgress(progress, `Synthesizing Scenes... (${completedCount}/${scenes.length})`);
                    return;
                }

                const response = await fetch("/api/openai/audio/speech", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "tts-1",
                        input: text,
                        voice: voice,
                        response_format: "mp3" 
                    })
                });

                if (!response.ok) {
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('Retry-After');
                        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000 * Math.pow(2, attempts);
                        await new Promise(r => setTimeout(r, waitTime));
                        throw new Error(`RATE_LIMIT`);
                    }
                    if (response.status === 401) {
                        throw new Error("OPENAI_API_KEY_MISSING");
                    }
                    throw new Error(`OPENAI_TTS_FAILED: ${response.status}`);
                }

                const blob = await response.blob();
                
                // Decode and trim silence
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const channelData = audioBuffer.getChannelData(0);
                const sampleRate = audioBuffer.sampleRate;
                
                // Simple trimming (similar to trimSilenceFromAudio)
                const threshold = 0.015;
                let startIdx = 0;
                let endIdx = channelData.length - 1;
                
                while (startIdx < channelData.length && Math.abs(channelData[startIdx]) < threshold) startIdx++;
                while (endIdx > 0 && Math.abs(channelData[endIdx]) < threshold) endIdx--;
                
                // Minimal padding to eliminate the pause between scenes
                const startPadding = Math.floor(sampleRate * 0.02);
                const endPadding = Math.floor(sampleRate * 0.02);
                startIdx = Math.max(0, startIdx - startPadding);
                endIdx = Math.min(channelData.length, endIdx + endPadding);
                
                if (startIdx >= endIdx) {
                    startIdx = 0;
                    endIdx = channelData.length;
                }

                // Removed minimum duration padding to avoid unnatural silences
                const trimmedLength = endIdx - startIdx;
                const pcm = new Int16Array(trimmedLength);
                for (let i = 0; i < trimmedLength; i++) {
                    const sample = (startIdx + i < channelData.length) ? channelData[startIdx + i] : 0;
                    pcm[i] = Math.max(-1, Math.min(1, sample)) * 32767;
                }

                // Store the buffer and exact duration
                const duration = trimmedLength / sampleRate;
                
                // We need to store these in order, so we'll attach them to the scene object temporarily
                (scene as any)._pcm = pcm;
                (scene as any)._duration = duration;

                completedCount++;
                const progress = Math.round(10 + (80 * completedCount / scenes.length));
                onProgress(progress, `Synthesizing Scenes... (${completedCount}/${scenes.length})`);
                
                return;
            } catch (error: any) {
                attempts++;
                if (attempts >= maxAttempts) throw error;
                if (error.message !== 'RATE_LIMIT') {
                    await new Promise(r => setTimeout(r, 1000 * attempts));
                }
            }
        }
    };

    // Process sequentially to ensure order and avoid rate limits, or use processInBatches
    // For perfect sync, we MUST process them and then calculate startTimes sequentially.
    await processInBatches(scenes, 3, fetchSceneAudio);

    // Now assemble the master audio and update scene timings sequentially
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const pcm = (scene as any)._pcm as Int16Array;
        const duration = (scene as any)._duration as number || 2; // fallback
        
        if (pcm) {
            pcmBuffers.push(pcm);
        } else {
            // Add silence to maintain perfect sync
            const silenceSamples = Math.floor(duration * 24000);
            pcmBuffers.push(new Int16Array(silenceSamples));
        }
        
        updatedScenes.push({
            ...scene,
            startTime: currentStartTime,
            endTime: currentStartTime + duration
        });
        
        currentStartTime += duration;
        
        // Clean up temporary data
        delete (scene as any)._pcm;
        delete (scene as any)._duration;
    }

    // Concatenate all PCM buffers
    const totalSamples = pcmBuffers.reduce((acc, buf) => acc + buf.length, 0);
    const masterPcm = new Int16Array(totalSamples);
    let offset = 0;
    for (const buf of pcmBuffers) {
        masterPcm.set(buf, offset);
        offset += buf.length;
    }

    const masterWavBlob = createWavBlob(masterPcm.buffer, 24000);
    audioContext.close();

    return { masterAudioBlob: masterWavBlob, updatedScenes, audioDuration: currentStartTime };
};

export const generateVoiceOver = async (text: string, voice: OpenAIVoice, onProgress: (p: number, m: string) => void): Promise<Blob> => {
    const cleanedText = text.replace(/[*_#~`]/g, '').trim();
    const chunks: string[] = [];
    let pos = 0;
    const CHUNK_SIZE = 1000; 

    while (pos < cleanedText.length) {
        let end = Math.min(pos + CHUNK_SIZE, cleanedText.length);
        if (end < cleanedText.length) {
            const lastPeriod = cleanedText.lastIndexOf('. ', end);
            if (lastPeriod > pos) end = lastPeriod + 1;
        }
        chunks.push(cleanedText.substring(pos, end).trim());
        pos = end;
    }

    onProgress(5, `Starting synthesis of ${chunks.length} parts...`);
    console.log(`[TTS] Starting synthesis for ${chunks.length} chunks.`);

    let completedCount = 0;
    const results: { blob: Blob, index: number }[] = [];

    const fetchChunk = async (chunk: string, index: number): Promise<void> => {
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                console.log(`[TTS] Requesting part ${index + 1}/${chunks.length} at ${new Date().toISOString()} (Attempt ${attempts + 1})...`);
                const startTime = Date.now();
                
                const response = await fetch("/api/openai/audio/speech", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "tts-1",
                        input: chunk,
                        voice: voice,
                        response_format: "mp3" 
                    })
                });

                if (!response.ok) {
                    // Check for rate limit
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('Retry-After');
                        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000 * Math.pow(2, attempts);
                        console.warn(`[TTS] Rate limit hit for part ${index + 1}. Waiting ${waitTime}ms...`);
                        await new Promise(r => setTimeout(r, waitTime));
                        throw new Error(`RATE_LIMIT`);
                    }
                    if (response.status === 401) {
                        throw new Error("OPENAI_API_KEY_MISSING");
                    }
                    
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(`OPENAI_TTS_FAILED: ${response.status} ${JSON.stringify(errData)}`);
                }

                const blob = await response.blob();
                const duration = Date.now() - startTime;
                completedCount++;
                
                console.log(`[TTS] Received part ${index + 1}/${chunks.length} (${(blob.size / 1024).toFixed(2)}KB) in ${duration}ms`);
                
                // Update progress based on COMPLETED count, not index
                const progress = Math.round(10 + (80 * completedCount / chunks.length));
                onProgress(progress, `Synthesizing Parts... (${completedCount}/${chunks.length})`);
                
                results.push({ blob, index });
                return; // Success, exit retry loop
                
            } catch (error: any) {
                attempts++;
                console.error(`[TTS] Part ${index + 1} failed (Attempt ${attempts}):`, error);
                
                if (attempts >= maxAttempts) {
                    throw error;
                }
                
                // Simple backoff for non-429 errors
                if (error.message !== 'RATE_LIMIT') {
                    await new Promise(r => setTimeout(r, 1000 * attempts));
                }
            }
        }
    };

    try {
        // Use processInBatches with a safe concurrency limit (e.g., 5)
        await processInBatches(chunks, 5, fetchChunk);
        
        // Sort by index to ensure audio is in correct order
        const sortedBlobs = results.sort((a, b) => a.index - b.index).map(r => r.blob);
        
        if (sortedBlobs.length !== chunks.length) {
            throw new Error(`TTS Synthesis incomplete. Expected ${chunks.length} parts, got ${sortedBlobs.length}.`);
        }

        onProgress(95, "Merging & Cleaning Audio...");
        const finalBlob = new Blob(sortedBlobs, { type: 'audio/mpeg' });
        
        return await trimSilenceFromAudio(finalBlob);
    } catch (error) {
        console.error("[TTS] Master synthesis error:", error);
        throw error;
    }
};

/**
 * SCRIPT FRAMEWORK DETERMINATION
 */
export const determineScriptFramework = async (topic: string): Promise<number> => {
    return executeWithRetry(async (client) => {
        const prompt = `Analyze the topic "${topic}" and categorize it into one of the following video duration buckets based on these rules:
        - 5 Minutes: High-level overviews of specific food items like fishes, honey, hamburgers, and hot sauces.
        - 6 Minutes: Slightly broader categories like ice cream and pizza styles.
        - 8 Minutes: More detailed lists such as nuts, sausages, and psychological tactics in restaurants.
        - 13 Minutes: Comprehensive look at global "food giants" or massive corporate/historical deep dives.
        
        Return ONLY the number (5, 6, 8, or 13) that best fits the topic.`;
        
        const res = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001", 
            messages: [{ role: "user", content: prompt }]
        });
        
        const text = res.choices[0].message.content?.trim() || "5";
        const duration = parseInt(text, 10);
        return [5, 6, 8, 13].includes(duration) ? duration : 5;
    });
};

/**
 * MASTER STORY ARCHITECT
 */
export const generateStoryOutline = async (topic: string, durationKey: number): Promise<ChapterOutline[]> => {
    const frameworks: Record<number, string> = {
        5: `Act as a script architect. Based on the title "${topic}", create a 5-minute video outline totaling 800 words. Divide the outline into 5 chapters. For each chapter, provide: 1) A target word count (Intro: 80, Chapters 1-4: 150 each, Outro: 120). 2) A Psychological Hook (e.g., 'The Mystery Factor' or 'The Childhood Nostalgia Trap'). 3) Specific Technical Details to include (e.g., origin dates, chemical compounds like methylglyoxal in Manuka honey, or specific processing methods like conching in chocolate). Ensure the flow follows the Serial Position Effect, putting the 'wow' facts in Chapter 1 and the Outro.`,
        6: `Act as a documentary storyteller. Create a 6-minute script outline for "${topic}" totaling 950 words. Split this into 6 chapters. Each chapter must include: 1) Word count distribution (Intro: 100, Chapters 1-5: 150 each, Outro: 100). 2) A 'Lure' Hook (connecting the food to a specific historical figure, like the Medici court for Gelato). 3) Technical Specs (e.g., fat percentages, specific tools like the potato ricer for Spaghetti Ice, or protected EU statuses). Maintain a narrative thread of 'Evolution'—how the food changed over time.`,
        8: `Act as a subject matter expert. Generate an 8-minute script outline for "${topic}" totaling 1,250 words. Break this into 8 chapters. For each: 1) Word count (Intro/Outro: 125 each, Chapters 1-6: 165 each). 2) A Psychological Anchor (use 'Decoy Pricing' logic—compare a common version to an extreme 'luxury' version to make the middle ground feel safe). 3) Technical Details (e.g., Scoville units for hot sauces, bacterial fermentation for Sujuk, or specific pressure requirements for cracking Macadamias).`,
        13: `Act as a master biographer. Create a 13-minute script outline for "${topic}" totaling 2,100 words. Break this into 10 detailed chapters. For each: 1) Word count (approx. 200 words per chapter). 2) A Controversy/Success Hook (e.g., corporate scandals like Nestle's water exploitation or the 'scurvy' clinical trials of lemons). 3) Technical/Historical Details (e.g., mergers like Kraft-Heinz, specific regional hybrids, or the 'closed-loop' systems of space food). Ensure the 'Ultimate Hook' is at the 10-minute mark to retain mid-roll viewers.`
    };

    const outlinePrompt = frameworks[durationKey] || frameworks[5];

    return executeWithRetry(async (client) => {
        const res = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001", 
            messages: [
                {
                    role: "system",
                    content: `${outlinePrompt}\n\nReturn the response as a JSON object with a "chapters" array containing objects with "title", "wordCount", and "description".`
                }
            ],
            response_format: { type: "json_object" },
            // @ts-ignore
            reasoning: { enabled: true }
        });
        const text = res.choices[0].message.content || '{"chapters":[]}';
        const parsed = JSON.parse(text);
        return parsed.chapters || parsed.outline || parsed.segments || [];
    });
};

/**
 * OUTLINE AUDITOR (Fact Check & Monetization)
 */
export const auditStoryOutline = async (outline: ChapterOutline[], topic: string): Promise<ChapterOutline[]> => {
    if (!outline || !Array.isArray(outline) || outline.length === 0) return [];
    
    return executeWithRetry(async (client) => {
        const prompt = `You are a professional script editor and YouTube monetization expert. Review this video outline about "${topic}".
        Ensure it is completely factually accurate, educational, and strictly adheres to YouTube 'Green Dollar' monetization policies.
        Correct any inaccuracies, remove any controversial/demonetizable topics, and return the corrected outline in the exact same JSON format.
        
        Outline to audit: ${JSON.stringify(outline)}
        
        [SAFETY]
        ${SAFETY_BLOCK}`;
        
        const res = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001", 
            messages: [
                {
                    role: "system",
                    content: `${prompt}\n\nReturn the response as a JSON object with a "chapters" array.`
                }
            ],
            response_format: { type: "json_object" },
            // @ts-ignore
            reasoning: { enabled: true }
        });
        const text = res.choices[0].message.content || '{"chapters":[]}';
        const parsed = JSON.parse(text);
        return parsed.chapters || parsed.outline || parsed.segments || [];
    });
};

/**
 * THE VIRAL MASTER SCRIPT GENERATOR
 */
export const generateStoryChapter = async (topic: string, chapter: ChapterOutline, prevSummary: string, fullOutline: string, idx: number, total: number, durationKey: number): Promise<{ content: string; summary: string }> => {
    const frameworks: Record<number, string> = {
        5: `Now, expand the chapter "${chapter.title}" into exactly ${chapter.wordCount} words. Use a high-energy, narrative tone. Avoid 'information overload' by focusing on the most 'vivid' adjectives. Ensure a seamless transition to the next chapter to maintain the narrative loop.`,
        6: `Expand the chapter "${chapter.title}" into ${chapter.wordCount} words. Use the vivid language technique found in successful restaurant menus to make the descriptions 'sizzling' and 'handcrafted'. The tone should be educational yet conversational.`,
        8: `Expand "${chapter.title}" into ${chapter.wordCount} words. Integrate the 'Serial Position' strategy—ensure this chapter ends with a 'cliffhanger' fact that leads into the next. Use specific, technical terminology to build authority, but keep the narrative 'flowy' and easy to follow.`,
        13: `Expand "${chapter.title}" into ${chapter.wordCount} words. Use a 'deep-dive' narrative style. Don't just list facts—tell a story of survival, innovation, or trickery. Use the Delbuff Illusion logic: focus on the 'big picture' first, then zoom into the small, technical details that make the topic 'feel' more generous and satisfying to the viewer.`
    };

    const chapterPrompt = frameworks[durationKey] || frameworks[5];

    return executeWithRetry(async (client) => {
        const prompt = `Act as a world-class documentary scriptwriter. 
Topic: ${topic}
Current Chapter: ${chapter.title}
Chapter Description & Details: ${chapter.description}
Segment ${idx} of ${total}

${chapterPrompt}

[FORMATTING INSTRUCTIONS]
- Return ONLY the spoken narration text.
- DO NOT include any labels like "[Introduction]", "Narrator:", "Visuals:", "Scene:", or "[Chapter]".
- DO NOT include any stage directions or visual descriptions.
- The output should be plain text that can be read directly by a voice-over artist.

Summary of Script Architecture (Based on Sources):
- Intro: Must use a "Grabber" (like the "Mad Honey" hallucinations).
- Body: Use Categorization (Fresh vs. Aged cheese) to prevent information fatigue.
- Outro: Must summarize using the Serial Position Effect to ensure the viewer leaves with the "Peak" information fresh in their mind.

[SAFETY]
${SAFETY_BLOCK}`;

        const res = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001", 
            messages: [
                {
                    role: "system",
                    content: `${prompt}\n\nReturn the response as a JSON object with "content" and "summary" fields.`
                }
            ],
            response_format: { type: "json_object" },
            // @ts-ignore
            reasoning: { enabled: true }
        });
        const text = res.choices[0].message.content || '{"content":"", "summary":""}';
        return JSON.parse(text);
    }, 5);
};

export const generateVideoMetadata = async (script: string, topic: string): Promise<string> => {
    const result = await executeWithRetry(async (client) => {
        const response = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: `Generate YouTube SEO metadata for this documentray: ${topic}. Script: ${script.substring(0, 4000)}\n\nReturn as JSON with "title", "description", "hashtags", "tags".`
                }
            ],
            response_format: { type: "json_object" }
        });
        const text = response.choices[0].message.content || '{}';
        return JSON.parse(text);
    }, 2);

    return `
${result.title}

${result.description}

🔔 Subscribe to The Napping Historian for more Boring History for Sleep.

${result.hashtags.join(' ')}

Tags: ${result.tags.join(', ')}
    `.trim();
};

export const generateThumbnailPrompt = async (videoTitle: string): Promise<{ textPrompt: string; imageUrl: string }> => {
    return await executeWithRetry(async (client) => {
        // 1. Deduce child detailed json from video title
        const childResponse = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: `Deduce a viral YouTube thumbnail detailed JSON prompt for a video titled: "${videoTitle}". 
                    The prompt should describe a high-impact, clickable visual representation of the subject.
                    Focus on 8 key elements that would make this thumbnail viral.
                    
                    Return as JSON with a "detailed_prompt" field.`
                }
            ],
            response_format: { type: "json_object" },
            // @ts-ignore
            reasoning: { enabled: true }
        });

        const childText = childResponse.choices[0].message.content || '{"detailed_prompt":""}';
        const childData = JSON.parse(childText);
        const childPrompt = childData.detailed_prompt;

        // 2. Construct Master JSON
        const masterJson = {
            "thumbnail_metadata": {
                "style": "Hyper-realistic digital illustration / Infographic",
                "background": "Solid minimalist white with soft drop shadows",
                "composition": "2x4 Grid layout",
                "lighting": "Top-down studio lighting with subtle specular highlights"
            },
            "asset_structure": {
                "item_count": 8,
                "elements": [
                    {
                        "position": "top_row",
                        "description": "Visual representation of the subject",
                        "label_style": "Bold sans-serif black text, centered underneath"
                    }
                ]
            },
            "generated_prompt": childPrompt
        };

        // 3. Convert JSON to Text Prompt (excluding negative prompts like timestamps)
        const textPromptResponse = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: `Convert the following JSON thumbnail specification into a single, highly detailed text prompt for an image generator. 
                    Ensure the prompt is cohesive and describes the layout, style, lighting, and all 8 elements clearly.
                    CRITICAL: DO NOT include any negative prompts, timestamps, or UI elements in the text.`
                },
                {
                    role: "user",
                    content: `JSON: ${JSON.stringify(masterJson)}`
                }
            ],
            // @ts-ignore
            reasoning: { enabled: true }
        });

        const textPrompt = textPromptResponse.choices[0].message.content?.trim() || childPrompt;

        // 4. Generate the image
        const imageUrl = await generateImageForScene(textPrompt, "16:9");

        return { textPrompt, imageUrl };
    }, 2);
};

export const analyzeScript = async (script: string, totalDuration: number): Promise<Scene[]> => {
    return generateScenes(script, totalDuration);
};
