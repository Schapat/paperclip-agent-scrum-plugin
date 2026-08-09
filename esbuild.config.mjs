import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

const workerBuildOptions = {
  ...presets.esbuild.worker,
  loader: {
    ...presets.esbuild.worker.loader,
    ".md": "text",
  },
};

const manifestBuildOptions = {
  ...presets.esbuild.manifest,
  loader: {
    ...presets.esbuild.manifest.loader,
    ".md": "text",
  },
};

const uiBuildOptions = {
  ...presets.esbuild.ui,
  loader: {
    ...presets.esbuild.ui.loader,
    ".css": "text",
  },
};

const workerCtx = await esbuild.context(workerBuildOptions);
const manifestCtx = await esbuild.context(manifestBuildOptions);
const uiCtx = await esbuild.context(uiBuildOptions);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose()]);
}
