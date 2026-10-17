"use client";

import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";
import { safeImageUrl } from "./types";

export function ProductImage({ src, alt, className = "", priority = false }: { src?: string | null; alt: string; className?: string; priority?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>();
  const imageRef = useRef<HTMLImageElement>(null);
  const safeSrc = safeImageUrl(src || "");
  useEffect(() => {
    // An eager SSR image can finish failing before React hydrates its error handler.
    if (safeSrc && imageRef.current?.complete && imageRef.current.naturalWidth === 0) setFailedSource(src);
  }, [safeSrc, src]);
  return safeSrc && failedSource !== src ? (
    // Merchant images may use any HTTPS host. Native loading avoids a permissive Next image proxy.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={imageRef} className={className} src={safeSrc} alt={alt} loading={priority ? "eager" : "lazy"} onError={() => setFailedSource(src)} />
  ) : (
    <div className={`image-fallback ${className}`} role="img" aria-label={alt}><Package size={42} strokeWidth={1} /><span>{alt}</span></div>
  );
}
