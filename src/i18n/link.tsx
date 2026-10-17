'use client';

import type { ComponentProps } from 'react';
import Link from 'next/link';
import { useLocale } from './provider';
import { localizePath } from './routing';

/** next/link that keeps the visitor in the active language. Accepts plain internal paths only. */
export function LocaleLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const locale = useLocale();
  return <Link {...props} href={localizePath(href, locale)} />;
}
