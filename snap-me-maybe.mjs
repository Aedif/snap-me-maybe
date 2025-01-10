import { patchPIXI } from './Point.js';

const MODULE_ID = 'aedifs-snap-me-maybe';
const settings = { shape: 'rectangle', sticky: true, debug: false };

Hooks.on('init', () => {
  game.settings.register(MODULE_ID, 'shape', {
    name: game.i18n.localize(`${MODULE_ID}.settings.shape.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.shape.hint`),
    config: true,
    type: String,
    default: settings.shape,
    choices: {
      rectangle: game.i18n.localize(`${MODULE_ID}.common.rectangle`),
      circle: game.i18n.localize(`${MODULE_ID}.common.circle`),
    },
    onChange: (val) => {
      settings.shape = val;
    },
  });
  settings.shape = game.settings.get(MODULE_ID, 'shape');

  game.settings.register(MODULE_ID, 'sticky', {
    name: game.i18n.localize(`${MODULE_ID}.settings.sticky.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.sticky.hint`),
    config: true,
    type: Boolean,
    default: settings.sticky,
    onChange: (val) => {
      settings.sticky = val;
    },
  });
  settings.sticky = game.settings.get(MODULE_ID, 'sticky');

  game.settings.register(MODULE_ID, 'debug', {
    name: game.i18n.localize(`${MODULE_ID}.settings.debug.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.debug.hint`),
    config: true,
    type: Boolean,
    default: settings.debug,
    onChange: (val) => {
      settings.debug = val;
      canvas.controls.debug.clear();
    },
  });
  settings.debug = game.settings.get(MODULE_ID, 'debug');

  patchPIXI();
});

Hooks.on('preUpdateToken', (tokenDoc, change, options, userId) => {
  if (
    game.user.id !== userId ||
    canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS ||
    !tokenDoc.object ||
    !['x', 'y', 'width', 'height'].some((k) => k in change)
  )
    return;

  if (game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT)) return;

  let { x, y, height, width } = change;

  // Simulate new token shape after the update
  const rect = new PIXI.Rectangle(
    x ?? tokenDoc.x,
    y ?? tokenDoc.y,
    (width ?? tokenDoc.width) * (canvas.grid.sizeX ?? canvas.grid.w), // v12
    (height ?? tokenDoc.height) * (canvas.grid.sizeY ?? canvas.grid.h) // v12
  );

  // Snap simulated shape
  const snappedCoords = Snapper.snap(rect, tokenDoc.object, settings);
  if (snappedCoords.x === rect.x && snappedCoords.y === rect.y) return;

  const collision = tokenDoc.object.checkCollision(tokenDoc.object.getCenterPoint(snappedCoords));
  if (!collision) foundry.utils.mergeObject(change, snappedCoords);
});

class Snapper {
  static _fallbackVector;

  static _debugShapes(shapes) {
    const dg = canvas.controls.debug;
    dg.clear();
    dg.lineStyle(1, 0x00ff00, 1);

    for (const shape of shapes) {
      if (shape instanceof PIXI.Rectangle) {
        dg.drawRect(shape.x, shape.y, shape.width, shape.height);
      } else {
        dg.drawEllipse(shape.center.x, shape.center.y, shape.radius, shape.radius);
      }
    }
  }

  /**
   * Snaps the provided rectangle to token in case of overlap.
   * @param {Pixi.Rectangle} rect    Rectangle representing new token position
   * @param {Token} token            Moved token
   * @param {Object} options
   * @param {String} options.shape   The shape to consider tokens as (rectangle|circle)
   * @param {String} options.sticky  If true right-angle moves will stick to tokens
   * @returns {Object}               x/y coordinates of the snapped rectangle
   */
  static snap(rect, token, { shape = 'rectangle', sticky = true, debug = false } = {}) {
    // Used during exact center to center overlaps
    this._fallbackVector = new PIXI.Point(token.center.x, token.center.y)
      .subtract(new PIXI.Point(rect.center.x, rect.center.y))
      .normalize();

    this._stickyRightAngleMove =
      sticky && ((Math.atan2(this._fallbackVector.y, this._fallbackVector.x) * 180) / Math.PI) % 90 === 0;

    // Select primitive shapes and functions to be used for hit testing and snapping
    let movedTokenShape, hitTestMove, tokenToShape;
    if (shape === 'rectangle') {
      movedTokenShape = rect.clone();
      hitTestMove = this._hitTestMoveRectangle.bind(this);
      tokenToShape = this._tokenToRectangle;
    } else {
      movedTokenShape = new PIXI.Circle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2);
      hitTestMove = this._hitTestMoveCircle.bind(this);
      tokenToShape = this._tokenToCircle;
    }

    // We'll be treating each token as a primitive shape so lets transform them here to
    // not need to keep repeating it during each iteration
    const shapes = canvas.tokens.placeables.filter((t) => t.id !== token.id && t.visible).map(tokenToShape);

    const maxSteps = 5000;
    let steps = 0;
    while (steps < maxSteps) {
      let hit = false;
      for (const shape of shapes) {
        hit = hitTestMove(movedTokenShape, shape) || hit;
      }

      if (!hit) break;
      hit = false;
      steps++;
    }

    if (debug) this._debugShapes(shapes.concat(movedTokenShape));

    // Get token x/y from primitive
    if (shape === 'rectangle') {
      return { x: movedTokenShape.x, y: movedTokenShape.y };
    } else {
      return {
        x: movedTokenShape.center.x - movedTokenShape.radius,
        y: movedTokenShape.center.y - movedTokenShape.radius,
      };
    }
  }

  static _tokenToRectangle(token) {
    return new PIXI.Rectangle(
      token.document.x,
      token.document.y,
      token.document.width * (canvas.grid.sizeX ?? canvas.grid.w), // v12
      token.document.height * (canvas.grid.sizeY ?? canvas.grid.h) // v12
    );
  }

  static _tokenToCircle(token) {
    const width = token.document.width * canvas.grid.w;
    return new PIXI.Circle(
      token.document.x + width / 2,
      token.document.y + (token.document.height * (canvas.grid.sizeY ?? canvas.grid.h)) / 2, // v12
      width / 2
    );
  }

  static _hitTestMoveRectangle(rect1, rect2, delta = 0.5) {
    if (rect1.overlaps(rect2)) {
      const c1 = new PIXI.Point(rect1.center.x, rect1.center.y);
      const c2 = new PIXI.Point(rect2.center.x, rect2.center.y);

      let vector;

      if (c1.x == c2.x && c1.y === c2.y) {
        // In case of exact overlap, use _fallbackVector, which points towards original token position
        if (this._fallbackVector) vector = this._fallbackVector.multiplyScalar(delta);
        else return false;
      } else if (this._stickyRightAngleMove) {
        const intersection = rect1.intersection(rect2);
        if (intersection.width * intersection.height > 100) {
          vector = this._fallbackVector.multiplyScalar(delta);
        } else {
          vector = c1.subtract(c2).normalize().multiplyScalar(delta);
        }
      } else {
        vector = c1.subtract(c2).normalize().multiplyScalar(delta);
      }

      rect1.x += vector.x;
      rect1.y += vector.y;

      return true;
    }
    return false;
  }

  static _hitTestMoveCircle(circle1, circle2, delta = 1) {
    const dR = circle1.radius + circle2.radius;
    const d = Math.hypot(circle1.x - circle2.x, circle1.y - circle2.y);
    if (d < dR) {
      const c1 = circle1.center;
      const c2 = circle2.center;

      let vector;
      if (c1.x == c2.x && c1.y === c2.y) {
        // In case of exact overlap, use _fallbackVector, which points towards original token position
        vector = this._fallbackVector.multiplyScalar(delta);
      } else if (this._stickyRightAngleMove) {
        vector = this._fallbackVector.multiplyScalar(delta);
      } else {
        vector = circle1.center.subtract(circle2.center).normalize();
        let scalar = dR - d;
        if (scalar > delta) scalar = delta;
        vector = vector.multiplyScalar(scalar);
      }

      circle1.x += vector.x;
      circle1.y += vector.y;

      return true;
    }
    return false;
  }
}
