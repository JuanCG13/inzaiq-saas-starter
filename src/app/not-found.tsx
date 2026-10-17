import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function NotFoundPage() { return <main id="main-content" className="boundary-page"><span className="eyebrow">404 / NOS DESVIAMOS UN POCO</span><h1>Por acá no era.</h1><p>La página que buscás no está disponible. Tu próximo favorito puede estar en la colección.</p><Link className="button primary" href="/">Volver a la tienda <ArrowRight size={16} /></Link></main>; }
