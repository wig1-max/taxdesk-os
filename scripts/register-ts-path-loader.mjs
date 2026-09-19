import { register } from "node:module";

register(new URL("./ts-path-loader.mjs", import.meta.url));
