/**
 * Patch PIXI.Point with required functions
 */
export function patchPIXI() {
  addClassMethod(PIXI.Point.prototype, 'subtract', subtract2d);
  addClassMethod(PIXI.Point.prototype, 'magnitude', magnitude2d);
  addClassMethod(PIXI.Point.prototype, 'normalize', normalize);
  addClassMethod(PIXI.Point.prototype, 'multiplyScalar', multiplyScalar2d);
}

/**
 * Subtract a point from this one.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function subtract2d(other, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x - other.x;
  outPoint.y = this.y - other.y;

  return outPoint;
}

/**
 * Normalize the point.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function normalize(outPoint) {
  return this.multiplyScalar(1 / this.magnitude(), outPoint);
}

/**
 * Magnitude (length, or sometimes distance) of this point.
 * Square root of the sum of squares of each component.
 * @returns {number}
 */
function magnitude2d() {
  // Same as Math.sqrt(this.x * this.x + this.y * this.y)
  return Math.hypot(this.x, this.y);
}

/**
 * Multiply `this` point by a scalar
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function multiplyScalar2d(scalar, outPoint) {
  outPoint ??= new this.constructor();
  outPoint.x = this.x * scalar;
  outPoint.y = this.y * scalar;
  return outPoint;
}

/**
 * Add a method or a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 * @param {object} [opts] Optional parameters
 * @param {boolean} [opts.getter]     True if the property should be made a getter.
 * @param {boolean} [opts.optional]   True if the getter should not be set if it already exists.
 * @returns {undefined|object<id{string}} Either undefined if the getter already exists or the cl.prototype.name.
 */
function addClassMethod(cl, name, fn, { getter = false, optional = false } = {}) {
  if (optional && Object.hasOwn(cl, name)) return undefined;
  const descriptor = { configurable: true };
  if (getter) descriptor.get = fn;
  else {
    descriptor.writable = true;
    descriptor.value = fn;
  }
  Object.defineProperty(cl, name, descriptor);

  const prototypeName = cl.constructor?.name;
  const id = `${prototypeName ?? cl.name}.${prototypeName ? 'prototype.' : ''}${name}`; // eslint-disable-line template-curly-spacing
  return { id, args: { cl, name } };
}
