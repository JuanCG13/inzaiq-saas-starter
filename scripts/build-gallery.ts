import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localizePath } from '../src/i18n/routing';
import { GROUPS, IMAGE, VIEWPORTS, imagePath, screenList, type Language, type ScreenDefinition, type ScreenGroup } from '../tests/screenshots/screens';

/**
 * Renders docs/screens.md (English captions) and docs/screens.es.md (Spanish captions) from the screenshot
 * manifest. Both pages show the same English images. Run by `npm run screenshots` after the tour;
 * tests/screens-manifest.test.ts fails when the committed pages differ from this output.
 *
 * Output depends only on the manifest, so it is identical on every machine and contains no dates.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

/** Thumbnail widths in CSS pixels. A phone capture is half as wide so both kinds take a similar height. */
const THUMBNAIL_WIDTH = { desktop: 360, mobile: 180 } as const;
const GROUP_ORDER: readonly ScreenGroup[] = ['storefront', 'bag', 'admin', 'account'];

export const GALLERY_FILES: Record<Language, string> = { en: 'docs/screens.md', es: 'docs/screens.es.md' };

const copy = {
  en: {
    title: 'Screen gallery',
    switch: '**English** · [Español](screens.es.md)',
    intro: [
      'Every screen of the demo application, captured from a real running installation with the browser tour in `tests/screenshots/`. Select a thumbnail for the full-size image. Each caption names the route under the `/en` language prefix.',
      'The data is the local demo seed (six sample products) plus a few fictional records that the tour creates through the real interface: customers on the reserved `example.invalid` domain, one sample owner account and one sample OAuth client. Nothing is real and no payment is processed. Order references and dates are the ones of the capture run.',
      'The images are in English. This page repeats the captions in English; the [Spanish page](screens.es.md) has Spanish captions for the same images.',
    ],
    regenerateTitle: 'Regenerate',
    regenerate: [
      'Install the browser once with `npx playwright install chromium`, then run:',
      '```bash\nnpm run screenshots\n```',
      `The command resets the local \`demo.db\`, starts the demo server, walks all ${screenList.length} screens and rebuilds this page and its Spanish counterpart. \`SCREENSHOT_LOCALE=es npm run screenshots\` runs the same tour against the Spanish interface and writes the git-ignored \`docs/screenshots/es/\`.`,
      'How the captures were made, the image-format measurements, the disclosed shortcuts and what is not shown are recorded in [screenshots/PROVENANCE.md](screenshots/PROVENANCE.md).',
    ],
    alt: (screen: ScreenDefinition) => `${screen.title.en}`,
    viewport: { desktop: 'Desktop', mobile: 'Phone' },
    fullImage: 'Full-size image',
  },
  es: {
    title: 'Galería de pantallas',
    switch: '[English](screens.md) · **Español**',
    intro: [
      'Todas las pantallas de la aplicación de demostración, capturadas de una instalación real en ejecución con el recorrido de navegador de `tests/screenshots/`. Seleccione una miniatura para ver la imagen completa. Cada pie indica la ruta bajo el prefijo de idioma `/en`.',
      'Los datos son la semilla local de demostración (seis productos de ejemplo) más unos pocos registros ficticios que el recorrido crea con la interfaz real: clientes en el dominio reservado `example.invalid`, una cuenta de propietario de ejemplo y un cliente OAuth de ejemplo. Nada es real y no se procesa ningún pago. Las referencias y fechas de los pedidos son las de la ejecución de la captura.',
      'Las imágenes están en inglés. Esta página ofrece los pies de foto en español para las mismas imágenes; la [página en inglés](screens.md) tiene los pies en inglés.',
    ],
    regenerateTitle: 'Regenerar',
    regenerate: [
      'Instale el navegador una vez con `npx playwright install chromium` y ejecute:',
      '```bash\nnpm run screenshots\n```',
      `El comando restablece el \`demo.db\` local, inicia el servidor de demostración, recorre las ${screenList.length} pantallas y reconstruye esta página y su equivalente en inglés. \`SCREENSHOT_LOCALE=es npm run screenshots\` ejecuta el mismo recorrido con la interfaz en español y escribe \`docs/screenshots/es/\`, que Git ignora.`,
      'Cómo se hicieron las capturas, las mediciones del formato de imagen, los atajos declarados y lo que no se muestra están en [screenshots/PROVENANCE.md](screenshots/PROVENANCE.md) (en inglés).',
    ],
    alt: (screen: ScreenDefinition) => `${screen.title.es}`,
    viewport: { desktop: 'Escritorio', mobile: 'Teléfono' },
    fullImage: 'Imagen completa',
  },
} as const;

/** Text that goes inside an HTML attribute or a table cell must not break either. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\|/g, '&#124;');
}

function relativeImage(id: string): string {
  return path.posix.relative('docs', imagePath(id, 'en'));
}

function cell(screen: ScreenDefinition, language: Language): string {
  const text = copy[language];
  const image = relativeImage(screen.id);
  const { width, height } = VIEWPORTS[screen.viewport];
  const thumbnail = THUMBNAIL_WIDTH[screen.viewport];
  const route = localizePath(screen.route, 'en');
  return [
    `<a href="${image}" title="${escapeHtml(text.fullImage)}"><img src="${image}" width="${thumbnail}" alt="${escapeHtml(text.alt(screen))}" /></a>`,
    `<br />**${escapeHtml(screen.title[language])}**`,
    `<br />\`${route}\` · ${text.viewport[screen.viewport]} ${width}×${height}`,
    `<br />${escapeHtml(screen.description[language])}`,
  ].join('');
}

function section(group: ScreenGroup, language: Language): string {
  const screens = screenList.filter(screen => screen.group === group);
  const rows: string[] = [];
  for (let index = 0; index < screens.length; index += 2) {
    rows.push(`| ${cell(screens[index], language)} | ${screens[index + 1] ? cell(screens[index + 1], language) : ''} |`);
  }
  return [`## ${GROUPS[group].title[language]}`, '', GROUPS[group].intro[language], '', '| | |', '| --- | --- |', ...rows].join('\n');
}

export function renderGallery(language: Language): string {
  const text = copy[language];
  return [
    `# ${text.title}`,
    '',
    text.switch,
    '',
    ...text.intro.flatMap(paragraph => [paragraph, '']),
    ...GROUP_ORDER.flatMap(group => [section(group, language), '']),
    `## ${text.regenerateTitle}`,
    '',
    ...text.regenerate.flatMap(paragraph => [paragraph, '']),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** Gallery page path (relative to the repository root) mapped to its exact content. */
export function galleryPages(): Record<string, string> {
  return Object.fromEntries((Object.keys(GALLERY_FILES) as Language[]).map(language => [GALLERY_FILES[language], renderGallery(language)]));
}

function main() {
  const missing = screenList.map(screen => imagePath(screen.id, 'en')).filter(file => !existsSync(path.join(root, file)));
  if (missing.length) throw new Error(`Missing ${IMAGE.extension.toUpperCase()} images, run the tour first (npm run screenshots):\n${missing.join('\n')}`);
  for (const [file, content] of Object.entries(galleryPages())) {
    writeFileSync(path.join(root, file), content);
    console.info(`wrote ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
