"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main-content" className="boundary-page"><span className="eyebrow">HAGAMOS UNA PAUSA</span><h1>Algo no salió como esperábamos.</h1><p>Podés volver a intentar. Tu bolsa sigue guardada en este navegador.</p><button className="button primary" onClick={reset}>Volver a intentar <RefreshCw size={16} /></button><Link className="text-link" href="/">Volver al inicio</Link></main>;
}
