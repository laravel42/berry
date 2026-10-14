/// <reference types="astro/client" />
/// <reference path="../node_modules/astro/astro-jsx.d.ts" />

declare namespace JSX {
	interface IntrinsicElements extends astroHTML.JSX.IntrinsicElements {}
}
