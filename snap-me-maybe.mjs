import { patchPIXI } from './Point.js';

const MODULE_ID = 'aedifs-snap-me-maybe';
const settings = { shape: 'rectangle', sticky: true, debug: false, wallSnap: false };

Hooks.on('init', () => {
  game.settings.register(MODULE_ID, 'shape', {
    name: game.i18n.localize(`${MODULE_ID}.settings.shape.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.shape.hint`),
    config: true,
    type: String,
    default: settings.shape,
    scope: 'world',
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
    scope: 'world',
    type: Boolean,
    default: settings.sticky,
    onChange: (val) => {
      settings.sticky = val;
    },
  });
  settings.sticky = game.settings.get(MODULE_ID, 'sticky');

  game.settings.register(MODULE_ID, 'wallSnap', {
    name: game.i18n.localize(`${MODULE_ID}.settings.wall-snap.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.wall-snap.hint`),
    config: true,
    scope: 'world',
    type: Boolean,
    default: settings.wallSnap,
    onChange: (val) => {
      settings.wallSnap = val;
    },
  });
  settings.wallSnap = game.settings.get(MODULE_ID, 'wallSnap');

  game.settings.register(MODULE_ID, 'debug', {
    name: game.i18n.localize(`${MODULE_ID}.settings.debug.name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.debug.hint`),
    config: true,
    type: Boolean,
    default: settings.debug,
    scope: 'world',
    onChange: (val) => {
      settings.debug = val;
      canvas.controls.debug.clear();
    },
  });
  settings.debug = game.settings.get(MODULE_ID, 'debug');

  patchPIXI();
});

Hooks.on('libWrapper.Ready', () => {
  libWrapper.register(
    MODULE_ID,
    'TokenDocument.prototype._preUpdate',
    function (wrapped, changed, options, user) {
      if (options.movement && !options._movementArguments) {
        if (game.keyboard.isModifierActive(foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT))
          return wrapped(changed, options, user);

        const move = options.movement[changed._id];
        const destination = move.waypoints[move.waypoints.length - 1];

        const rect = new PIXI.Rectangle(
          destination.x,
          destination.y,
          (changed.width ?? this.width) * canvas.grid.sizeX,
          (changed.height ?? this.height) * canvas.grid.sizeY
        );

        const snappedCoords = Snapper.snap(rect, this.object, settings);
        if (
          Number.isFinite(snappedCoords.x) &&
          Number.isFinite(snappedCoords.y) &&
          (snappedCoords.x !== rect.x || snappedCoords.y !== rect.y)
        ) {
          const collision = this.object.checkCollision(this.object.getCenterPoint(snappedCoords));
          if (!collision) {
            destination.x = Math.floor(snappedCoords.x);
            destination.y = Math.floor(snappedCoords.y);
          }
        }
      }

      return wrapped(changed, options, user);
    },
    'WRAPPER'
  );
});

class LineShape {
  isLine = true;

  constructor(wall) {
    this.A = { x: wall.document.c[0], y: wall.document.c[1] };
    this.B = { x: wall.document.c[2], y: wall.document.c[3] };
  }

  getPerpendicularVector(P) {
    const A = this.A;
    const B = this.B;
    const ABx = B.x - A.x;
    const ABy = B.y - A.y;
    const APx = P.x - A.x;
    const APy = P.y - A.y;

    const AB_length_squared = ABx * ABx + ABy * ABy;
    const t = Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / AB_length_squared));

    const Q = new PIXI.Point(A.x + t * ABx, A.y + t * ABy);

    return new PIXI.Point(P.x - Q.x, P.y - Q.y);
  }

  draw(graphics) {
    graphics.moveTo(this.A.x, this.A.y).lineTo(this.B.x, this.B.y);
  }
}

class RectangleShape extends PIXI.Rectangle {
  constructor(token, rectangle) {
    if (rectangle) {
      super(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    } else {
      super(
        token.document.x,
        token.document.y,
        token.document.width * canvas.grid.sizeX,
        token.document.height * canvas.grid.sizeY
      );
    }
  }

  hitTestMove(shape, delta = 0.5) {
    if (shape.isLine) {
      return this._hitTestLine(shape, delta);
    }

    if (this.overlaps(shape)) {
      const c1 = new PIXI.Point(this.center.x, this.center.y);
      const c2 = new PIXI.Point(shape.center.x, shape.center.y);

      let vector;

      if (c1.x == c2.x && c1.y === c2.y) {
        // In case of exact overlap, use _fallbackVector, which points towards original token position
        if (this._fallbackVector) vector = this._fallbackVector.multiplyScalar(delta);
        else return false;
      } else if (this._stickyRightAngleMove) {
        const intersection = this.intersection(shape);
        if (intersection.width * intersection.height > 100) {
          vector = this._fallbackVector.multiplyScalar(delta);
        } else {
          vector = c1.subtract(c2).normalize().multiplyScalar(delta);
        }
      } else {
        vector = c1.subtract(c2).normalize().multiplyScalar(delta);
      }

      this.x += vector.x;
      this.y += vector.y;

      return true;
    }
    return false;
  }

  _hitTestLine(line, delta) {
    for (const edge of [this.topEdge, this.bottomEdge, this.leftEdge, this.rightEdge]) {
      if (foundry.utils.lineSegmentIntersects(line.A, line.B, edge.A, edge.B)) {
        let vector = line.getPerpendicularVector(this.center).normalize().multiplyScalar(delta);
        this.x += vector.x;
        this.y += vector.y;
        return true;
      }
    }

    return false;
  }

  getTokenCoord() {
    return { x: this.x, y: this.y };
  }

  draw(graphics) {
    graphics.drawRect(this.x, this.y, this.width, this.height);
  }
}

class CircleShape extends PIXI.Circle {
  constructor(token, rectangle) {
    if (rectangle) {
      super(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2, rectangle.width / 2);
    } else {
      const width = token.document.width * canvas.grid.sizeX;
      super(
        token.document.x + width / 2,
        token.document.y + (token.document.height * canvas.grid.sizeY) / 2,
        width / 2
      );
    }
  }

  hitTestMove(shape, delta = 0.5) {
    if (shape.isLine) {
      return this._hitTestLine(shape, delta);
    }

    const dR = this.radius + shape.radius;
    const d = Math.hypot(this.x - shape.x, this.y - shape.y);
    if (d < dR) {
      const c1 = this.center;
      const c2 = shape.center;

      let vector;
      if (c1.x == c2.x && c1.y === c2.y) {
        // In case of exact overlap, use _fallbackVector, which points towards original token position
        vector = this._fallbackVector.multiplyScalar(delta);
      } else if (this._stickyRightAngleMove) {
        vector = this._fallbackVector.multiplyScalar(delta);
      } else {
        vector = this.center.subtract(shape.center).normalize();
        let scalar = dR - d;
        if (scalar > delta) scalar = delta;
        vector = vector.multiplyScalar(scalar);
      }

      this.x += vector.x;
      this.y += vector.y;

      return true;
    }
    return false;
  }

  _hitTestLine(line, delta) {
    const intersection = foundry.utils.lineCircleIntersection(line.A, line.B, { x: this.x, y: this.y }, this.radius);
    if (intersection.intersections.length > 0) {
      const vector = line.getPerpendicularVector({ x: this.x, y: this.y }).normalize().multiplyScalar(delta);
      this.x += vector.x;
      this.y += vector.y;
      return true;
    }
    return false;
  }

  getTokenCoord() {
    return {
      x: this.center.x - this.radius,
      y: this.center.y - this.radius,
    };
  }

  draw(graphics) {
    graphics.drawEllipse(this.center.x, this.center.y, this.radius, this.radius);
  }
}

class Snapper {
  static _fallbackVector;

  static _debugShapes(shapes) {
    const dg = canvas.controls.debug;
    dg.clear();
    dg.lineStyle(1, 0x00ff00, 1);

    for (const shape of shapes) {
      shape.draw(dg);
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
  static snap(rect, token, { shape = 'rectangle', sticky = true, debug = false, wallSnap = false } = {}) {
    // Used during exact center to center overlaps
    this._fallbackVector = new PIXI.Point(token.center.x, token.center.y)
      .subtract(new PIXI.Point(rect.center.x, rect.center.y))
      .normalize();

    this._stickyRightAngleMove =
      sticky && ((Math.atan2(this._fallbackVector.y, this._fallbackVector.x) * 180) / Math.PI) % 90 === 0;

    const movedTokenShape = shape === 'rectangle' ? new RectangleShape(null, rect) : new CircleShape(null, rect);

    // We'll be treating each token as a primitive shape so lets transform them here to
    // not need to keep repeating it during each iteration
    const shapes = canvas.tokens.placeables
      .filter((t) => t.id !== token.id && t.visible)
      .map(function (token) {
        return shape === 'rectangle' ? new RectangleShape(token) : new CircleShape(token);
      });

    // If enabled include walls as collideables
    if (wallSnap) {
      canvas.walls.placeables.forEach((wall) => {
        if (wall.document.move !== 0) shapes.push(new LineShape(wall));
      });
    }

    const maxSteps = 5000;
    let steps = 0;
    while (steps < maxSteps) {
      let hit = false;
      for (const shape of shapes) {
        hit = movedTokenShape.hitTestMove(shape, 1) || hit;
      }

      if (!hit) break;
      hit = false;
      steps++;
    }

    if (debug) this._debugShapes(shapes.concat(movedTokenShape));

    // Get token x/y from primitive
    return movedTokenShape.getTokenCoord();
  }
}
