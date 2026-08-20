// Installs null-css.loader.mjs. Use as: node --import ./tools/null-css.register.mjs <script>
import { register } from 'node:module';
register('./null-css.loader.mjs', import.meta.url);
