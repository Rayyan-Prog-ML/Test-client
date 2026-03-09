import React, { useRef, useEffect } from 'react';
import { Scene } from '../types';

interface TimelineProps {
  scenes: Scene[];
  audioDuration: number;
  currentTime: number;
  onSceneSelect: (sceneId: string) => void;
  selectedSceneId: string | null;
  onUpdateSceneTimes: (scenes: Scene[]) => void;
}

const Timeline: React.FC<TimelineProps> = ({
  scenes,
  audioDuration,
  currentTime,
  onSceneSelect,
  selectedSceneId,
  onUpdateSceneTimes
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate width percentage
  const getLeft = (time: number) => (time / audioDuration) * 100;
  const getWidth = (start: number, end: number) => ((end - start) / audioDuration) * 100;

  return (
    <div className="w-full h-32 bg-gray-900 rounded-lg border border-gray-700 relative overflow-hidden select-none mt-4">
      {/* Time Markers */}
      <div className="absolute top-0 left-0 w-full h-6 border-b border-gray-700 flex text-xs text-gray-500">
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} className="flex-1 border-r border-gray-800 pl-1">
            {Math.round((audioDuration / 10) * i)}s
          </div>
        ))}
      </div>

      {/* Tracks Container */}
      <div className="absolute top-6 left-0 right-0 bottom-0 overflow-y-auto p-2" ref={containerRef}>
        <div className="relative w-full h-full flex">
          {scenes.map((scene, idx) => (
            <div
              key={scene.id}
              onClick={() => onSceneSelect(scene.id)}
              className={`
                absolute h-16 rounded cursor-pointer border transition-colors overflow-hidden group
                ${selectedSceneId === scene.id ? 'bg-brand-600 border-brand-400 z-10' : 'bg-gray-800 border-gray-600 hover:bg-gray-750'}
              `}
              style={{
                left: `${getLeft(scene.startTime)}%`,
                width: `${getWidth(scene.startTime, scene.endTime)}%`,
              }}
              title={scene.visualDescription}
            >
              <div className="p-1 text-[10px] leading-tight text-gray-300 truncate font-mono">
                #{idx + 1}
              </div>
              {scene.videoUrl || scene.videoClipUrl ? (
                <video 
                  src={scene.videoUrl || scene.videoClipUrl} 
                  className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-30 pointer-events-none" 
                  muted 
                  loop 
                  autoPlay
                />
              ) : scene.imageUrl ? (
                <img 
                  src={scene.imageUrl} 
                  className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-30 pointer-events-none" 
                  alt="scene thumbnail"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center opacity-20 text-xs">
                  Generating...
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none transition-all duration-75"
        style={{ left: `${(currentTime / audioDuration) * 100}%` }}
      />
    </div>
  );
};

export default Timeline;