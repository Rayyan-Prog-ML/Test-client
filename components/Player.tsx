
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Scene, AspectRatio, ProcessingStatus } from '../types';

interface PlayerProps {
  audioUrl: string | null;
  scenes: Scene[];
  aspectRatio: AspectRatio;
  videoTitle?: string;
  onTimeUpdate: (time: number) => void;
  setProcessingStatus: (status: ProcessingStatus) => void;
  backgroundAudioFile: File | null;
  backgroundVolume: number;
  enableBackgroundMusic: boolean;
  enableEmbers: boolean;
  filmGrainStrength: number;
  enableVaporOverlay: boolean;
  vaporOverlayFile: File | null;
  vaporOverlayOpacity: number;
  triggerAutoExport: boolean;
  onExportStarted: () => void;
  onExportComplete: () => void;
  isBatchMode: boolean;
  fullScript: string;
}

const TRANSITION_DURATION = 0.5; 
const EXPORT_FPS = 30; 
const EXPORT_BITRATE = 10000000;

const Player: React.FC<PlayerProps> = ({ 
  audioUrl, 
  scenes, 
  aspectRatio,
  videoTitle,
  onTimeUpdate,
  setProcessingStatus,
  backgroundAudioFile,
  backgroundVolume,
  enableBackgroundMusic,
  enableEmbers,
  filmGrainStrength,
  enableVaporOverlay,
  vaporOverlayFile,
  vaporOverlayOpacity,
  onExportStarted,
  onExportComplete,
}) => {
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement>(null); 
  const vaporVideoRef = useRef<HTMLVideoElement>(null); 
  
  const video1 = useRef<HTMLVideoElement>(null); 
  const video2 = useRef<HTMLVideoElement>(null);

  const animationFrameRef = useRef<number>(0);
  const recordedChunks = useRef<Blob[]>([]);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const particlesRef = useRef<any[]>([]);
  const grainCacheRef = useRef<HTMLCanvasElement | null>(null);
  
  const isExportingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const setPlaying = (val: boolean) => {
    setIsPlaying(val);
    isPlayingRef.current = val;
  };

  const setExporting = (val: boolean) => {
    setIsExporting(val);
    isExportingRef.current = val;
  };
  const lastActiveSceneId = useRef<string | null>(null);
  const currentSceneIdxRef = useRef<number>(0);
  const nextPreloadIdxRef = useRef<number>(-1);

  const getDimensions = () => {
    switch (aspectRatio) {
      case '9:16': return { width: 720, height: 1280 };
      case '1:1': return { width: 720, height: 720 };
      case '16:9': 
      default: return { width: 1280, height: 720 };
    }
  };

  const { width, height } = getDimensions();

  useEffect(() => {
    const grainCanvas = document.createElement('canvas');
    grainCanvas.width = 256; 
    grainCanvas.height = 256;
    const gctx = grainCanvas.getContext('2d');
    if (gctx) {
      const imageData = gctx.createImageData(256, 256);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const val = Math.random() * 255;
        imageData.data[i] = val;
        imageData.data[i+1] = val;
        imageData.data[i+2] = val;
        imageData.data[i+3] = 255;
      }
      gctx.putImageData(imageData, 0, 0);
      grainCacheRef.current = grainCanvas;
    }
  }, []);

  useEffect(() => {
    scenes.forEach(scene => {
      if (scene.imageUrl && !imageCache.current.has(scene.imageUrl)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = scene.imageUrl;
        img.onload = () => { imageCache.current.set(scene.imageUrl!, img); };
      }
    });
  }, [scenes]);

  const drawMediaToCanvas = (ctx: CanvasRenderingContext2D, media: HTMLImageElement | HTMLVideoElement, layout: string = 'centered') => {
    const mWidth = media instanceof HTMLImageElement ? media.width : (media as HTMLVideoElement).videoWidth;
    const mHeight = media instanceof HTMLImageElement ? media.height : (media as HTMLVideoElement).videoHeight;
    if (mWidth === 0 || mHeight === 0) return;

    let targetAreaWidth = width;
    let targetAreaHeight = height;
    let targetAreaX = 0;
    let targetAreaY = 0;

    if (layout === 'split-left') {
        targetAreaWidth = width / 2;
        targetAreaX = 0;
    } else if (layout === 'split-right') {
        targetAreaWidth = width / 2;
        targetAreaX = width / 2;
    }

    // Calculate scale to fit within the target area with some padding
    const padding = 40;
    const availableWidth = targetAreaWidth - padding * 2;
    const availableHeight = targetAreaHeight - padding * 2;
    
    // Always force a square card for that "editorial" look
    const cardSize = Math.min(availableWidth, availableHeight);
    
    // Use cover logic for both split and centered layouts to fill the square card
    const drawWidth = cardSize;
    const drawHeight = cardSize;
    
    const x = targetAreaX + (targetAreaWidth - drawWidth) / 2;
    const y = targetAreaY + (targetAreaHeight - drawHeight) / 2;

    // Draw Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 20;

    // Rounded Rect Clip for the media
    const radius = 32;
    ctx.beginPath();
    ctx.roundRect(x, y, drawWidth, drawHeight, radius);
    ctx.fillStyle = '#fff';
    ctx.fill(); 
    
    // Add stroke
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.stroke();

    ctx.clip();

    // Always use "cover" logic to fill the target area perfectly
    const mediaScale = Math.max(drawWidth / mWidth, drawHeight / mHeight);
    const sw = drawWidth / mediaScale;
    const sh = drawHeight / mediaScale;
    const sx = (mWidth - sw) / 2;
    const sy = (mHeight - sh) / 2;
    ctx.drawImage(media, sx, sy, sw, sh, x, y, drawWidth, drawHeight);
    
    ctx.restore();
  };

  const drawOverlayText = (ctx: CanvasRenderingContext2D, text: string, layout: string = 'centered') => {
    if (!text) return;
    
    // Strip asterisks
    text = text.replace(/\*\*/g, '');
    
    ctx.save();
    ctx.fillStyle = '#FFF';
    ctx.strokeStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    
    let textX = width / 2;
    let textY = height / 2;
    
    // Determine max width based on layout
    const maxWidth = layout === 'centered' ? width * 0.85 : (width / 2) - 80;

    if (layout === 'split-left') {
        ctx.textAlign = 'left';
        textX = width / 2 + 40; 
    } else if (layout === 'split-right') {
        ctx.textAlign = 'right';
        textX = width / 2 - 40; 
    } else if (layout === 'centered') {
        textY = height * 0.15; // Move text to the top for centered layout
    }

    // Dynamic Font Scaling Logic
    let fontSize = 64;
    ctx.font = `900 ${fontSize}px "Inter", sans-serif`;
    
    // Check if any single word is wider than maxWidth
    const words = text.split(' ');
    for (const word of words) {
        let metrics = ctx.measureText(word.toUpperCase());
        while (metrics.width > maxWidth && fontSize > 20) {
            fontSize -= 2;
            ctx.font = `900 ${fontSize}px "Inter", sans-serif`;
            metrics = ctx.measureText(word.toUpperCase());
        }
    }

    // Now wrap lines with the potentially reduced font size
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const testLine = currentLine + ' ' + words[i];
        const metrics = ctx.measureText(testLine.toUpperCase());
        if (metrics.width > maxWidth) {
            lines.push(currentLine);
            currentLine = words[i];
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);

    // Vertical centering adjustment
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = textY - (totalHeight / 2) + (lineHeight / 2);

    ctx.lineWidth = fontSize * 0.15;

    lines.forEach((line, i) => {
        const y = startY + i * lineHeight;
        ctx.strokeText(line.toUpperCase(), textX, y);
        ctx.fillText(line.toUpperCase(), textX, y);
    });

    ctx.restore();
  };

  /**
   * VELOCITY-SYNC RENDERING
   * Adjusts playbackRate to catch up rather than seeking (which causes stutter).
   */
  const renderSceneFrame = (ctx: CanvasRenderingContext2D, scene: Scene, time: number, alpha: number, transform?: { scale?: number, offsetX?: number, offsetY?: number, clipProgress?: number, transitionType?: string, skipText?: boolean }) => {
      if (alpha <= 0) return;
      
      ctx.save();
      ctx.globalAlpha = alpha;
      
      const sceneDuration = Math.max(0.1, scene.endTime - scene.startTime);
      const elapsed = Math.max(0, Math.min(sceneDuration, time - scene.startTime));
      
      const videoUrl = scene.videoUrl || scene.videoClipUrl;
      const v = (video1.current?.src === videoUrl) ? video1.current : 
                (video2.current?.src === videoUrl) ? video2.current : null;

      const isVideoReady = videoUrl && v && v.readyState >= 3;

      // Apply transformations
      if (transform) {
          const { scale = 1, offsetX = 0, offsetY = 0, clipProgress = 1, transitionType } = transform;
          
          if (transitionType === 'polygon-wipe' && clipProgress < 1) {
              ctx.beginPath();
              // Hexagon wipe
              const centerX = width / 2;
              const centerY = height / 2;
              const radius = Math.max(width, height) * clipProgress * 1.2;
              for (let i = 0; i < 6; i++) {
                  const angle = (i * Math.PI) / 3;
                  const x = centerX + radius * Math.cos(angle);
                  const y = centerY + radius * Math.sin(angle);
                  if (i === 0) ctx.moveTo(x, y);
                  else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.clip();
          }

          ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
          ctx.scale(scale, scale);
          ctx.translate(-width / 2, -height / 2);
      }

      if (isVideoReady) {
          const baseRate = (v.duration || sceneDuration) / sceneDuration;
          
          // LOOP VS STRETCH LOGIC
          // If the scene is loopable and long, we prefer looping at normal speed (1.0x)
          // rather than stretching to a very slow speed.
          const shouldLoop = scene.isLoopable && sceneDuration > (v.duration || 5);
          
          let targetTime: number;
          let playbackRate: number;

          if (shouldLoop) {
              v.loop = true;
              playbackRate = 1.0; // Keep normal speed for loopable backgrounds
              targetTime = elapsed % (v.duration || 5);
          } else {
              v.loop = false;
              playbackRate = Number.isFinite(baseRate) ? baseRate : 1.0;
              targetTime = elapsed * playbackRate;
          }

          // Ensure targetTime is a valid finite number before setting
          if (!Number.isFinite(targetTime) || isNaN(targetTime)) {
              targetTime = 0;
          }

          const drift = v.currentTime - targetTime;

          // During export, we allow a smaller drift threshold for hard-seeking to keep sync perfect.
          const isSeeking = (isExportingRef.current && Math.abs(drift) > 0.5) || (!isExportingRef.current && Math.abs(drift) > 2.0);
          // During export, we use the same smooth sync as preview
          const isCurrentlySeeking = v.seeking || v.readyState < 3;

          if (isSeeking && Number.isFinite(targetTime)) {
              v.currentTime = targetTime;
          }
          
          if (Math.abs(drift) > 0.05 && Number.isFinite(playbackRate)) {
            v.playbackRate = drift > 0 ? playbackRate * 0.95 : playbackRate * 1.05;
          } else if (Number.isFinite(playbackRate)) {
            v.playbackRate = playbackRate;
          }
          
          if ((isPlayingRef.current || isExportingRef.current) && v.paused) v.play().catch(() => {});
          
          if (!isCurrentlySeeking) {
            drawMediaToCanvas(ctx, v, scene.layout);
          } else if (scene.imageUrl && imageCache.current.has(scene.imageUrl)) {
            drawMediaToCanvas(ctx, imageCache.current.get(scene.imageUrl)!, scene.layout);
          }
      } else if (scene.imageUrl && imageCache.current.has(scene.imageUrl)) {
          drawMediaToCanvas(ctx, imageCache.current.get(scene.imageUrl)!, scene.layout);
      }

      // Draw Overlay Text
      if (scene.overlayText && !transform?.skipText) {
          drawOverlayText(ctx, scene.overlayText, scene.layout);
      }
      
      ctx.restore();
  };

  const draw = useCallback(() => {
    const canvas = videoCanvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || isExportingRef.current) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    
    const currentTime = audio.currentTime;
    onTimeUpdate(currentTime);

    // Optimized index lookup with jump protection
    let idx = currentSceneIdxRef.current;
    if (idx >= scenes.length || currentTime < scenes[idx].startTime || currentTime >= scenes[idx].endTime) {
        idx = scenes.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);
        if (idx !== -1) currentSceneIdxRef.current = idx;
    }
    
    const activeScene = idx !== -1 ? scenes[idx] : null;

    // AGGRESSIVE PRE-LOADING
    // Preload current AND next scene
    if (idx !== -1) {
        const scenesToPreload = [idx, idx + 1].filter(i => i < scenes.length);
        
        scenesToPreload.forEach(pIdx => {
            const s = scenes[pIdx];
            const url = s.videoUrl || s.videoClipUrl;
            if (url) {
                const v1 = video1.current;
                const v2 = video2.current;
                if (v1 && v1.src !== url && v2 && v2.src !== url) {
                    // Find the least important video node to swap
                    const targetV = (v1.paused || v1.ended) ? v1 : v2;
                    if (targetV.src !== url) {
                        targetV.src = url;
                        targetV.load();
                    }
                }
            }
        });
    }

    // Clear canvas for each frame to prevent ghosting
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    if (activeScene) {
      const tIn = currentTime - activeScene.startTime;
      
      // Handle transitions ONLY at the start of a scene (transitioning from the previous one)
      if (idx > 0 && tIn < TRANSITION_DURATION) {
          const progress = tIn / TRANSITION_DURATION;
          const transitionType = activeScene.transitionType || 'standard';

          switch (transitionType) {
              case 'zoom-through':
                  renderSceneFrame(ctx, scenes[idx - 1], currentTime, 1 - progress, { scale: 1 + progress, skipText: true });
                  renderSceneFrame(ctx, activeScene, currentTime, progress, { scale: 0.5 + 0.5 * progress });
                  break;
              case 'polygon-wipe':
                  renderSceneFrame(ctx, scenes[idx - 1], currentTime, 1.0, { skipText: true });
                  renderSceneFrame(ctx, activeScene, currentTime, 1.0, { clipProgress: progress, transitionType: 'polygon-wipe' });
                  break;
              case 'parallax-2.5d':
                  renderSceneFrame(ctx, scenes[idx - 1], currentTime, 1 - progress, { offsetX: -progress * 100, skipText: true });
                  renderSceneFrame(ctx, activeScene, currentTime, progress, { offsetX: (1 - progress) * 100 });
                  break;
              case 'standard':
              default:
                  renderSceneFrame(ctx, scenes[idx - 1], currentTime, 1 - progress, { skipText: true });
                  renderSceneFrame(ctx, activeScene, currentTime, progress);
                  break;
          }
      } else {
          // Normal rendering for the rest of the scene
          renderSceneFrame(ctx, activeScene, currentTime, 1.0);
      }
    }

    if (enableEmbers) updateParticles(ctx);
    if (enableVaporOverlay && vaporVideoRef.current && vaporVideoRef.current.readyState >= 2) {
        ctx.save();
        ctx.globalAlpha = vaporOverlayOpacity;
        ctx.globalCompositeOperation = 'screen'; 
        ctx.drawImage(vaporVideoRef.current, 0, 0, width, height);
        ctx.restore();
    }
    if (filmGrainStrength > 0) drawFilmGrain(ctx);

    // Persistent loop: keep drawing as long as we are in "playing" state, 
    // even if audio is temporarily buffering or paused.
    if (isPlayingRef.current && !audio.ended) {
      animationFrameRef.current = requestAnimationFrame(draw);
    } else if (audio.ended) {
      setPlaying(false);
      video1.current?.pause();
      video2.current?.pause();
    }
  }, [scenes, width, height, enableEmbers, filmGrainStrength, enableVaporOverlay, vaporOverlayOpacity]);

  const updateParticles = (ctx: CanvasRenderingContext2D, isDeterministic: boolean = false) => {
    if (!enableEmbers) { particlesRef.current = []; return; }
    if (particlesRef.current.length < 50 && (isDeterministic || Math.random() > 0.6)) {
         particlesRef.current.push({
             x: Math.random() * width, y: height + 10,
             vx: (Math.random() - 0.5) * 1.2, vy: -Math.random() * 2.5 - 0.8,
             size: Math.random() * 2.0 + 0.5, life: 180,
             color: `rgba(255, ${Math.floor(Math.random() * 100) + 120}, 40,`
         });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx; p.y += p.vy; p.life--;
        const alpha = Math.min(0.7, p.life / 60);
        ctx.fillStyle = `${p.color} ${alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0 || p.y < -20) particlesRef.current.splice(i, 1);
    }
    ctx.restore();
  };

  const drawFilmGrain = (ctx: CanvasRenderingContext2D) => {
    if (!grainCacheRef.current) return;
    ctx.save();
    ctx.globalAlpha = filmGrainStrength * 0.15;
    ctx.globalCompositeOperation = 'overlay';
    const ptrn = ctx.createPattern(grainCacheRef.current, 'repeat');
    if (ptrn) {
      ctx.translate(Math.random() * 256, Math.random() * 256);
      ctx.fillStyle = ptrn;
      ctx.fillRect(-256, -256, width + 512, height + 512);
    }
    ctx.restore();
  };

  useEffect(() => {
    if (isPlaying) draw();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isPlaying, draw]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlayingRef.current) {
        audioRef.current.pause();
        bgAudioRef.current?.pause();
        vaporVideoRef.current?.pause();
        video1.current?.pause();
        video2.current?.pause();
        setPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        if (enableBackgroundMusic) bgAudioRef.current?.play();
        if (enableVaporOverlay) vaporVideoRef.current?.play().catch(() => {});
        setPlaying(true);
      }
    }
  };

  const handleExport = async () => {
    try {
      setProcessingStatus({ step: 'exporting', progress: 1, message: 'Export requested...' });
      if (isExportingRef.current) return;
      setExporting(true);
      onExportStarted();
      lastActiveSceneId.current = null; // Reset for export

      setProcessingStatus({ step: 'exporting', progress: 5, message: 'Warming Master Render Engine...' });
      
      // Give the UI a chance to render the "Warming..." message
      await new Promise(resolve => setTimeout(resolve, 100));

      setProcessingStatus({ step: 'exporting', progress: 7, message: 'Checking browser compatibility...' });
      if (typeof window.AudioContext === 'undefined' && typeof (window as any).webkitAudioContext === 'undefined') {
        throw new Error("AudioContext is not supported in this browser.");
      }
      if (typeof MediaRecorder === 'undefined') {
        throw new Error("MediaRecorder is not supported in this browser.");
      }
      if (!audioUrl) {
        throw new Error("Audio URL is missing. Please generate narration first.");
      }

      setProcessingStatus({ step: 'exporting', progress: 8, message: 'Initializing Audio Context...' });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();

      setProcessingStatus({ step: 'exporting', progress: 10, message: 'Fetching audio assets...' });
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
      
      setProcessingStatus({ step: 'exporting', progress: 15, message: 'Preparing audio buffer...' });
      const arrayBuffer = await response.arrayBuffer();
      
      setProcessingStatus({ step: 'exporting', progress: 20, message: 'Decoding master narration...' });
      const mainBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      setProcessingStatus({ step: 'exporting', progress: 25, message: 'Syncing video tracks...' });
      const mainSource = audioCtx.createBufferSource();
      mainSource.buffer = mainBuffer;
      mainSource.connect(dest);

      if (!videoCanvasRef.current) throw new Error("Video canvas not found.");
      if (!(videoCanvasRef.current as any).captureStream) {
        throw new Error("Your browser does not support canvas stream capture. Please use Chrome or Firefox.");
      }
      const canvasStream = videoCanvasRef.current.captureStream(EXPORT_FPS); 
      
      setProcessingStatus({ step: 'exporting', progress: 30, message: 'Configuring media recorder...' });
      const audioTracks = dest.stream.getAudioTracks();
      const videoTracks = canvasStream.getVideoTracks();
      
      if (videoTracks.length === 0) throw new Error("No video tracks found in canvas stream.");
      if (audioTracks.length === 0) throw new Error("No audio tracks found in media destination.");
      
      const combinedStream = new MediaStream([...videoTracks, ...audioTracks]);
      
      let mimeType = '';
      if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
          mimeType = 'video/webm;codecs=vp9,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
          mimeType = 'video/webm;codecs=vp8,opus';
      } else {
          mimeType = 'video/webm';
      }
      
      console.log("Starting MediaRecorder with mimeType:", mimeType);
      
      const recorder = new MediaRecorder(combinedStream, { 
          mimeType, 
          videoBitsPerSecond: EXPORT_BITRATE 
      });
      
      // Small delay to ensure tracks are fully initialized
      await new Promise(resolve => setTimeout(resolve, 500));
      
      recordedChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.current.push(e.data); };
      
      recorder.onstop = () => {
        try {
          const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const videoBlob = new Blob(recordedChunks.current, { type: mimeType });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(videoBlob);
          a.download = `${videoTitle || 'master_production'}.${extension}`;
          a.click();
          setExporting(false);
          onExportComplete();
          audioCtx.close();
        } catch (err) {
          console.error("Export finalization failed:", err);
          setExporting(false);
          setProcessingStatus({ step: 'idle', progress: 0, message: 'Export finalization failed.' });
        }
      };

      setProcessingStatus({ step: 'exporting', progress: 35, message: 'Starting render engine...' });
      await audioCtx.resume();
      
      const startTime = audioCtx.currentTime;
      recorder.start();
      mainSource.start(startTime);

      const totalT = mainBuffer.duration + 0.5; // Add padding to prevent cutting
      const frameDuration = 1 / EXPORT_FPS;
      let firstFrame = true;

      const exportLoop = () => {
        if (!isExportingRef.current) return;
        
        if (firstFrame) {
          setProcessingStatus({ step: 'exporting', progress: 40, message: 'Processing frames...' });
          firstFrame = false;
        }

        const virtualT = Math.max(0, audioCtx.currentTime - startTime);
        const ctx = videoCanvasRef.current?.getContext('2d');
        
        if (ctx) {
          let idx = scenes.findIndex(s => virtualT >= s.startTime && virtualT < s.endTime);
          const s = idx !== -1 ? scenes[idx] : null;

          if (s) {
            const activeVideoUrl = s.videoUrl || s.videoClipUrl;
            if (s.id !== lastActiveSceneId.current) {
                lastActiveSceneId.current = s.id;
                const prevScene = idx > 0 ? scenes[idx - 1] : null;
                const v1Match = video1.current?.src === activeVideoUrl;
                const v2Match = video2.current?.src === activeVideoUrl;
                if (!v1Match && !v2Match && activeVideoUrl) {
                    let nextV = video1.current;
                    if (prevScene) {
                        const prevVideoUrl = prevScene.videoUrl || prevScene.videoClipUrl;
                        if (video1.current?.src === prevVideoUrl) {
                            nextV = video2.current;
                        } else if (video2.current?.src === prevVideoUrl) {
                            nextV = video1.current;
                        }
                    }
                    if (nextV) { nextV.src = activeVideoUrl; nextV.load(); }
                }
            }

            // Clear canvas ONLY after we know we have a scene to draw
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);

            const tIn = virtualT - s.startTime;
            if (idx > 0 && tIn < TRANSITION_DURATION) {
              const progress = tIn / TRANSITION_DURATION;
              const transitionType = s.transitionType || 'standard';

              switch (transitionType) {
                  case 'zoom-through':
                      renderSceneFrame(ctx, scenes[idx - 1], virtualT, 1 - progress, { scale: 1 + progress, skipText: true });
                      renderSceneFrame(ctx, s, virtualT, progress, { scale: 0.5 + 0.5 * progress });
                      break;
                  case 'polygon-wipe':
                      renderSceneFrame(ctx, scenes[idx - 1], virtualT, 1.0, { skipText: true });
                      renderSceneFrame(ctx, s, virtualT, 1.0, { clipProgress: progress, transitionType: 'polygon-wipe' });
                      break;
                  case 'parallax-2.5d':
                      renderSceneFrame(ctx, scenes[idx - 1], virtualT, 1 - progress, { offsetX: -progress * 100, skipText: true });
                      renderSceneFrame(ctx, s, virtualT, progress, { offsetX: (1 - progress) * 100 });
                      break;
                  case 'standard':
                  default:
                      renderSceneFrame(ctx, scenes[idx - 1], virtualT, 1 - progress, { skipText: true });
                      renderSceneFrame(ctx, s, virtualT, progress);
                      break;
              }
            } else {
              renderSceneFrame(ctx, s, virtualT, 1.0);
            }
          }

          if (enableEmbers) updateParticles(ctx, true);
          if (filmGrainStrength > 0) drawFilmGrain(ctx);
          
          setProcessingStatus({ 
            step: 'exporting', progress: Math.min(99, Math.round((virtualT/totalT)*100)), 
            message: `Smooth Export: Part ${idx+1}/${scenes.length}` 
          });

          if (virtualT < totalT) {
            requestAnimationFrame(exportLoop);
          } else {
            // Final frame capture delay
            setTimeout(() => {
              recorder.stop();
            }, 200);
          }
        }
      };

      requestAnimationFrame(exportLoop);
    } catch (e) { 
        console.error("Export engine crash details:", e);
        setExporting(false);
        setProcessingStatus({ step: 'idle', progress: 0, message: `Export engine crash: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative rounded-2xl overflow-hidden shadow-2xl border-2 border-gray-800 bg-black group transition-all duration-500 hover:border-brand-500/50">
        <canvas ref={videoCanvasRef} width={width} height={height} className="max-w-full h-auto cursor-pointer" onClick={togglePlay} />
        {!isPlaying && !isExporting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none group-hover:bg-black/30 transition-all">
                <div className="w-20 h-20 rounded-full bg-brand-500/90 flex items-center justify-center text-white text-3xl shadow-2xl backdrop-blur-md border border-white/20 transform group-hover:scale-110 transition-transform">▶</div>
            </div>
        )}
      </div>
      <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0.01, pointerEvents: 'none', width: 10, height: 10, overflow: 'hidden', zIndex: -1 }}>
        <audio ref={audioRef} src={audioUrl || undefined} crossOrigin="anonymous" />
        <audio ref={bgAudioRef} crossOrigin="anonymous" />
        <video ref={vaporVideoRef} playsInline muted loop preload="auto" crossOrigin="anonymous" />
        <video ref={video1} playsInline muted preload="auto" crossOrigin="anonymous" />
        <video ref={video2} playsInline muted preload="auto" crossOrigin="anonymous" />
      </div>
      <div className="flex gap-4">
        <button onClick={togglePlay} className="px-12 py-4 rounded-full font-bold bg-brand-600 text-white shadow-xl hover:bg-brand-500 transition-all active:scale-95 flex items-center gap-2">
          {isPlaying ? 'PAUSE' : 'PREVIEW'}
        </button>
        <button onClick={handleExport} disabled={isExporting || scenes.length === 0 || !audioUrl} className="px-12 py-4 rounded-full font-bold bg-emerald-600 text-white disabled:opacity-50 shadow-xl hover:bg-emerald-500 transition-all active:scale-95">
          {isExporting ? 'EXPORTING...' : 'DOWNLOAD HD MP4'}
        </button>
      </div>
    </div>
  );
};

export default Player;
