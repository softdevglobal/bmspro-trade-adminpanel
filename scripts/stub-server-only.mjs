// Lets unit tests import modules guarded by `import "server-only"`. Next
// bundles that package internally, so it is not resolvable under plain Node;
// point it at Next's own no-op build of the module.
import { registerHooks } from "node:module";

const EMPTY_MODULE = new URL(
  "../node_modules/next/dist/compiled/server-only/empty.js",
  import.meta.url,
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: EMPTY_MODULE, format: "commonjs", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
