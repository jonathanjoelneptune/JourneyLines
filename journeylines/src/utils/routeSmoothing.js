// Compatibility facade retained for v7.1.2 imports and historical verification.
// v7.1.3 uses lightweight corridor-preserving presentation geometry instead of
// dense equal-distance smoothing.
export {
  buildSurfacePresentationGeometry,
  isSurfaceRouteMode,
  presentationPointBudget,
  smoothSurfaceRouteGeometry,
  surfaceRouteRenderSamples
} from './routePresentation.js';
