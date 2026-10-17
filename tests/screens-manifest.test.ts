import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { GALLERY_FILES, galleryPages, renderGallery } from '../scripts/build-gallery';
import { localizePath } from '../src/i18n/routing';
import { webpSize } from './screenshots/image-info';
import { GROUPS, IMAGE, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, VIEWPORTS, imagePath, screenList, type Language } from './screenshots/screens';

/**
 * Keeps the documentation screenshots honest without a server or a browser: the manifest is well formed,
 * every committed image exists, fits its byte budget and has the size its viewport promises, and the two
 * gallery pages are exactly what scripts/build-gallery.ts renders from the manifest.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file));
const languages: Language[] = ['en', 'es'];

describe('screen manifest', () => {
  test('ids are unique, stable file names', () => {
    const ids = screenList.map(screen => screen.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test('every screen has a known group, viewport, route and a title and description in both languages', () => {
    for (const screen of screenList) {
      expect(Object.keys(GROUPS), screen.id).toContain(screen.group);
      expect(Object.keys(VIEWPORTS), screen.id).toContain(screen.viewport);
      expect(screen.route.startsWith('/'), `${screen.id} route`).toBe(true);
      for (const language of languages) {
        expect(screen.title[language].trim(), `${screen.id} title ${language}`).not.toBe('');
        expect(screen.description[language].trim(), `${screen.id} description ${language}`).not.toBe('');
      }
      expect(screen.title.es, `${screen.id} Spanish title is translated`).not.toBe(screen.title.en);
      expect(screen.description.es, `${screen.id} Spanish description is translated`).not.toBe(screen.description.en);
    }
  });

  test('every group has screens and a translated heading and introduction', () => {
    for (const [group, definition] of Object.entries(GROUPS)) {
      expect(screenList.some(screen => screen.group === group), group).toBe(true);
      expect(definition.title.es).not.toBe(definition.title.en);
      expect(definition.intro.es).not.toBe(definition.intro.en);
    }
  });

  test('image paths come from the manifest, one per screen, in the language folder', () => {
    expect(imagePath('admin-orders')).toBe(`docs/screenshots/en/admin-orders.${IMAGE.extension}`);
    expect(imagePath('admin-orders', 'es')).toBe(`docs/screenshots/es/admin-orders.${IMAGE.extension}`);
  });
});

describe('committed images', () => {
  test('exist for every screen and nothing else lives in the English folder', () => {
    const directory = path.join(root, 'docs/screenshots/en');
    expect(existsSync(directory), 'run npm run screenshots to create docs/screenshots/en').toBe(true);
    expect(readdirSync(directory).sort()).toEqual(screenList.map(screen => `${screen.id}.${IMAGE.extension}`).sort());
  });

  test(`each image is a ${IMAGE.extension.toUpperCase()} of the promised pixel size under the byte budget`, () => {
    for (const screen of screenList) {
      const file = imagePath(screen.id);
      const bytes = read(file);
      expect(bytes.length, `${file} size`).toBeGreaterThan(1_000);
      expect(bytes.length, `${file} is over ${MAX_IMAGE_BYTES} bytes`).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
      const size = webpSize(bytes);
      expect(size, `${file} is not a WebP file`).not.toBeNull();
      const viewport = VIEWPORTS[screen.viewport];
      expect(size!.width, `${file} width`).toBe(viewport.width);
      if (screen.fullPage) expect(size!.height, `${file} full-page height`).toBeGreaterThanOrEqual(viewport.height);
      else expect(size!.height, `${file} viewport height`).toBe(viewport.height);
    }
  });

  test('the whole set stays under the total budget', () => {
    const total = screenList.reduce((sum, screen) => sum + statSize(imagePath(screen.id)), 0);
    expect(total, `set is ${total} bytes`).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  test('the four obsolete Spanish PNG files are gone', () => {
    for (const file of ['admin-overview.png', 'runtime-settings.png', 'storefront.png', 'storefront-mobile.png']) {
      expect(existsSync(path.join(root, 'docs/screenshots', file)), file).toBe(false);
    }
  });
});

function statSize(file: string): number { return statSync(path.join(root, file)).size; }

describe('gallery pages', () => {
  test('are exactly what the builder renders from the manifest (no drift)', () => {
    for (const [file, content] of Object.entries(galleryPages())) {
      // A boolean keeps the failure short; the pages are long and a string diff would fill the terminal.
      expect(read(file).toString('utf8') === content, `${file} is stale: run npm run screenshots (or node --import tsx scripts/build-gallery.ts)`).toBe(true);
    }
  });

  test('reference every image once per page, linked at full size, with the route as code', () => {
    for (const language of languages) {
      const page = renderGallery(language);
      for (const screen of screenList) {
        const image = `screenshots/en/${screen.id}.${IMAGE.extension}`;
        expect(page.split(`src="${image}"`).length - 1, `${GALLERY_FILES[language]} thumbnail of ${screen.id}`).toBe(1);
        expect(page, `${GALLERY_FILES[language]} link to ${screen.id}`).toContain(`<a href="${image}"`);
        expect(page).toContain(`\`${localizePath(screen.route, 'en')}\``);
        expect(page).toContain(screen.title[language]);
      }
      // The git-ignored Spanish run is mentioned in the text but never linked: the gallery only uses the English images.
      expect(page).not.toMatch(/(?:src|href)="screenshots\/es\//);
    }
  });

  test('switch to the other language and keep the English images', () => {
    expect(renderGallery('en')).toContain('[Español](screens.es.md)');
    expect(renderGallery('es')).toContain('[English](screens.md)');
    expect(renderGallery('es')).toContain('screenshots/en/');
  });

  test('every image has alternative text and is not referenced from outside the manifest', () => {
    for (const language of languages) for (const match of renderGallery(language).matchAll(/<img [^>]*>/g)) expect(match[0]).toMatch(/alt="[^"]+"/);
  });
});

describe('provenance record', () => {
  test('names every screen, the command and the format decision', () => {
    const provenance = read('docs/screenshots/PROVENANCE.md').toString('utf8');
    for (const screen of screenList) expect(provenance, `PROVENANCE.md does not mention ${screen.id}`).toContain(`\`${screen.id}\``);
    expect(provenance).toContain('npm run screenshots');
    expect(provenance).toContain('SCREENSHOT_LOCALE');
    expect(provenance.toLowerCase()).toContain(IMAGE.format);
  });
});
