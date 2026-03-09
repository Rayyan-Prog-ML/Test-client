
export type TransitionType = 'standard' | 'zoom-through' | 'polygon-wipe' | 'parallax-2.5d';

export interface Scene {
  id: string;
  scriptSegment: string;
  visualDescription: string;
  imagePrompt?: string;
  videoPrompt?: string;
  transitionType?: TransitionType;
  startTime: number; // in seconds
  endTime: number; // in seconds
  imageUrl?: string; // base64 or object URL
  videoClipUrl?: string; // object URL for imported video clips
  videoUrl?: string; // URL for generated video clips
  assetType?: 'image' | 'video';
  layout?: 'centered' | 'split-left' | 'split-right';
  overlayText?: string;
  isLoopable?: boolean;
  isGeneratingImage: boolean;
  isGeneratingVideo: boolean;
}

export interface ProcessingStatus {
  step: 'idle' | 'refining' | 'analyzing' | 'generating_images' | 'generating_videos' | 'generating_metadata' | 'generating_words' | 'generating_thumbnails' | 'ready' | 'exporting' | 'learning_style' | 'generating_scenes' | 'generating_image_prompts' | 'generating_video_prompts' | 'importing_assets';
  progress: number; // 0-100
  message: string;
}

export type AspectRatio = "16:9" | "9:16" | "1:1";

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface BatchItem {
  id: string;
  title: string;
  script: string;
  status: 'queued' | 'generating_script' | 'waiting_for_audio' | 'processing_visuals' | 'completed' | 'error';
  audioFile: File | null;
  audioDuration: number;
}

export interface ThumbnailStudioState {
  isOpen: boolean;
  referenceImages: string[]; // base64 strings of uploaded samples
  analyzedStyles: string[]; // Extracted style prompts
  customTitle: string;
  generatedImage: string | null;
  isAnalyzing: boolean;
  isGenerating: boolean;
}

export interface ChapterOutline {
  title: string;
  wordCount: number;
  description: string;
}

export interface ProjectState {
  videoTitle: string;
  audioFile: File | null;
  audioDuration: number;
  scriptText: string;
  ttsVoice: OpenAIVoice;
  scenes: Scene[];
  aspectRatio: AspectRatio;
  // Atmosphere & FX
  backgroundAudioFile: File | null;
  backgroundVolume: number; // 0 to 1
  enableBackgroundMusic: boolean;
  enableEmbers: boolean;
  filmGrainStrength: number; // 0 to 1
  enableVaporOverlay: boolean;
  vaporOverlayFile: File | null;
  vaporOverlayOpacity: number; // 0 to 1
  // Metadata
  generatedMetadata: string | null;
  // Thumbnails
  viralWordsCandidates: string[]; // List of 5 words
  selectedViralWord: string | null;
  generatedThumbnails: string[]; // Array of base64 images
  // Thumbnail Studio
  thumbnailStudio: ThumbnailStudioState;
  // Visual Master Stage
  visualStage: 'idle' | 'scenes' | 'image_prompts' | 'video_prompts';
}
