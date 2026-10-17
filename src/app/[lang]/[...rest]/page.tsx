import { notFound } from "next/navigation";

/**
 * Any path under a language prefix that matches no page ends here, so the visitor gets the translated
 * not-found.tsx inside the language layout instead of Next.js' built-in English 404 page.
 */
export default function UnmatchedPage(): never { notFound(); }
