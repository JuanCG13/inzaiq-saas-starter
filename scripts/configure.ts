import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIGURE_USAGE, PRICES_NOT_CONVERTED_NOTICE, configureSource, describeConfig } from './lib/configure';

/**
 * `npm run configure -- --name "Your Business" --currency USD --currencies USD,EUR --locale en --locales en,es`
 * Rewrites src/template.config.ts after validating language and currency with the application's own validators.
 */
const configPath = fileURLToPath(new URL('../src/template.config.ts', import.meta.url));

try {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      description: { type: 'string' },
      currency: { type: 'string' },
      currencies: { type: 'string' },
      locale: { type: 'string' },
      locales: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.info(CONFIGURE_USAGE);
  } else {
    const { help: _help, ...options } = values;
    const { source, config, changed, notes } = configureSource(readFileSync(configPath, 'utf8'), options);
    if (changed) writeFileSync(configPath, source);
    console.info(changed ? 'Configuration updated in src/template.config.ts.' : 'Configuration already up to date; src/template.config.ts was not modified.');
    for (const line of describeConfig(config)) console.info(`  ${line}`);
    for (const note of notes) console.info(`Note: ${note}`);
    console.info(PRICES_NOT_CONVERTED_NOTICE);
    if (changed) console.info('Rebuild or restart the app to apply it; the default currency only affects new products and empty totals.');
  }
} catch (error) {
  // Messages come from our own validators and the argument parser and contain no secrets or stack traces.
  console.error(`configure: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Run "npm run configure -- --help" for the available options.');
  process.exitCode = 1;
}
