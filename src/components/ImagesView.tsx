'use client';

import Image from 'next/image';
import React, { useEffect, useRef } from 'react';

export interface GalleryImageItem {
  id: string;
  url: string;
  name: string;
  timestamp: string;
  prompt: string;
}

interface ImagesViewProps {
  images: GalleryImageItem[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

const formatImageTime = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const ImagesView: React.FC<ImagesViewProps> = ({ images, isLoading, hasMore, onLoadMore }) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    if (!sentinelRef.current) return;

    const node = sentinelRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { rootMargin: '180px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (isLoading && images.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-primary/15 bg-primary/5 h-44 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!isLoading && images.length === 0) {
    return (
      <div className="flex flex-col justify-center items-center h-[calc(100vh-10rem)] text-center">
        <p className="text-primary/70 text-base">No generated images yet</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {images.map((image, index) => (
          <button
            key={image.id}
            onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
            className="group relative overflow-hidden rounded-lg border border-primary/15 bg-background hover:border-primary/30 transition-colors"
            title={image.prompt || image.name}
          >
            <Image
              src={image.url}
              alt={image.prompt || image.name || 'Generated image'}
              width={560}
              height={560}
              className="w-full h-44 object-cover"
              loading={index < 8 ? 'eager' : 'lazy'}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
            <div className="absolute inset-x-0 bottom-0 bg-background/90 backdrop-blur-[1px] px-2.5 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[11px] text-primary/80 truncate">{image.prompt || image.name}</p>
              <p className="text-[10px] text-primary/50 mt-0.5">{formatImageTime(image.timestamp)}</p>
            </div>
          </button>
        ))}
      </div>

      {hasMore ? (
        <div ref={sentinelRef} className="h-10 flex items-center justify-center">
          {isLoading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" /> : null}
        </div>
      ) : null}
    </div>
  );
};
