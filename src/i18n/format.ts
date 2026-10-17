import { defaultFormatLocale } from './runtime';

/** Number, currency and date formatting. Money is always integer minor units until this point. */

export function currencyFactor(currency: string): number {
  return 10 ** (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2);
}

export function formatMoney(minor: number, currency: string, formatLocale: string = defaultFormatLocale): string {
  return new Intl.NumberFormat(formatLocale, { style: 'currency', currency }).format(minor / currencyFactor(currency));
}

export function formatNumber(value: number, formatLocale: string = defaultFormatLocale): string {
  return new Intl.NumberFormat(formatLocale).format(value);
}

const shortDateTime: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };

export function formatDateTime(value: string | number | Date, formatLocale: string = defaultFormatLocale, options: Intl.DateTimeFormatOptions = shortDateTime): string {
  return new Intl.DateTimeFormat(formatLocale, options).format(new Date(value));
}
