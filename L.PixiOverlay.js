// Leaflet.PixiOverlay
// version: 2.0.0-beta.1
// author: Manuel Baclet <mbaclet@gmail.com>
// license: MIT
// Pixi.js v8 compatible with backward compatibility for v7

(function (factory) {
  if (typeof define === "function" && define.amd) {
    // AMD
    define(["leaflet", "pixi.js"], factory);
  } else if (typeof module !== "undefined") {
    // Node/CommonJS
    module.exports = factory(require("leaflet"), require("pixi.js"));
  } else {
    // Browser globals
    if (typeof window.L === "undefined") {
      throw new Error("Leaflet must be loaded first");
    }
    if (typeof window.PIXI === "undefined") {
      throw new Error("Pixi.js must be loaded first");
    }
    factory(window.L, window.PIXI);
  }
})(function (L, PIXI) {
  var round = L.Point.prototype._round;
  var no_round = function () {
    return this;
  };

  function setEventSystem(
    renderer,
    destroyInteractionManager,
    autoPreventDefault
  ) {
    // v8+ always uses renderer.events, v6- uses plugins.interaction, v7 supports both
    var eventSystem;
    if (PIXI.VERSION >= "8") {
      // v8+: Always use renderer.events
      eventSystem = renderer.events;
    } else if (PIXI.VERSION >= "7") {
      // v7: Prefer renderer.events if available, fallback to plugins.interaction
      eventSystem = renderer.events || renderer.plugins.interaction;
    } else {
      // v6-: Use plugins.interaction
      eventSystem = renderer.plugins.interaction;
    }

    if (destroyInteractionManager) {
      eventSystem.destroy();
    } else if (!autoPreventDefault) {
      eventSystem.autoPreventDefault = false;
    }
  }

  function projectionZoom(map) {
    var maxZoom = map.getMaxZoom();
    var minZoom = map.getMinZoom();
    if (maxZoom === Infinity) return minZoom + 8;

    return (maxZoom + minZoom) / 2;
  }

  // Helper function to detect if we need async initialization (Pixi.js v8+)
  function needsAsyncInit() {
    return PIXI.VERSION >= "8";
  }

  // Helper function to check WebGL support with v8 compatibility
  function isWebGLSupported() {
    if (PIXI.utils && PIXI.utils.isWebGLSupported) {
      // v7 and earlier
      return PIXI.utils.isWebGLSupported();
    } else if (typeof PIXI.isWebGLSupported === "function") {
      // v8+ direct function
      return PIXI.isWebGLSupported();
    } else {
      // Fallback detection
      try {
        var canvas = document.createElement("canvas");
        return !!(
          canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
        );
      } catch (e) {
        return false;
      }
    }
  }

  // Async renderer creation for v8+
  async function createRendererAsync(options) {
    if (typeof PIXI.autoDetectRenderer === "function") {
      // v8+ async pattern
      return await PIXI.autoDetectRenderer(options);
    } else {
      // Fallback to sync for older versions
      return PIXI.autoDetectRenderer(options);
    }
  }

  var pixiOverlayClass = {
    options: {
      // @option padding: Number = 0.1
      // How much to extend the clip area around the map view (relative to its size)
      // e.g. 0.1 would be 10% of map view in each direction
      padding: 0.1,
      // @option forceCanvas: Boolean = false
      // Force use of a 2d-canvas
      forceCanvas: false,
      // @option doubleBuffering: Boolean = false
      // Help to prevent flicker when refreshing display on some devices (e.g. iOS devices)
      // It is ignored if rendering is done with 2d-canvas
      doubleBuffering: false,
      // @option resolution: Number = 1
      // Resolution of the renderer canvas
      resolution: L.Browser.retina ? 2 : 1,
      // @option projectionZoom(map: map): Number
      // return the layer projection zoom level
      projectionZoom: projectionZoom,
      // @option destroyInteractionManager:  Boolean = false
      // Destroy PIXI EventSystem
      destroyInteractionManager: false,
      // @option
      // Customize PIXI EventSystem autoPreventDefault property
      // This option is ignored if destroyInteractionManager is set
      autoPreventDefault: true,
      // @option resolution: Boolean = false
      // Enables drawing buffer preservation
      preserveDrawingBuffer: false,
      // @option resolution: Boolean = true
      // Clear the canvas before the new render pass
      clearBeforeRender: true,
      // @option shouldRedrawOnMove(e: moveEvent): Boolean
      // filter move events that should trigger a layer redraw
      shouldRedrawOnMove: function () {
        return false;
      },
    },

    initialize: function (drawCallback, pixiContainer, options) {
      L.setOptions(this, options);
      L.stamp(this);
      this._drawCallback = drawCallback;
      this._pixiContainer = pixiContainer;
      this._rendererOptions = {
        resolution: this.options.resolution,
        antialias: true,
        forceCanvas: this.options.forceCanvas,
        preserveDrawingBuffer: this.options.preserveDrawingBuffer,
        clearBeforeRender: this.options.clearBeforeRender,
      };

      if (PIXI.VERSION < "6") {
        this._rendererOptions.transparent = true;
      } else {
        this._rendererOptions.backgroundAlpha = 0;
      }

      this._doubleBuffering =
        isWebGLSupported() &&
        !this.options.forceCanvas &&
        this.options.doubleBuffering;

      // v8+ compatibility: mark if we need async initialization
      this._needsAsyncInit = needsAsyncInit();
      this._rendererReady = false;
      this._rendererPromise = null;

      // Warn users about async requirements in v8+
      if (this._needsAsyncInit) {
        console.warn(
          "Pixi.js v8+ detected. Consider using L.pixiOverlayAsync() for better performance and error handling."
        );
      }
    },

    _setMap: function () {},

    _setContainerStyle: function () {},

    _addContainer: function () {
      this.getPane().appendChild(this._container);
    },

    _setEvents: function () {},

    onAdd: function (targetMap) {
      this._setMap(targetMap);
      if (!this._container) {
        var container = (this._container = L.DomUtil.create(
          "div",
          "leaflet-pixi-overlay"
        ));
        container.style.position = "absolute";

        // v8+ requires async initialization
        if (this._needsAsyncInit) {
          // Store deferred update for when renderer is ready
          var _layer = this;
          this._deferredUpdate = function () {
            _layer._frame = null;
            _layer._update();
          };
          this._initializeRendererAsync(container);
        } else {
          // v7 and earlier - sync initialization
          this._initializeRendererSync(container);
        }
      }
      this._addContainer();
      this._setEvents();

      // Complete initialization for sync case
      if (!this._needsAsyncInit) {
        this._completeInitialization();
      }
    },

    // Async renderer initialization for v8+
    _initializeRendererAsync: function (container) {
      var _layer = this;

      // Start async renderer creation
      this._rendererPromise = createRendererAsync(this._rendererOptions)
        .then(function (renderer) {
          try {
            _layer._renderer = renderer;
            setEventSystem(
              renderer,
              _layer.options.destroyInteractionManager,
              _layer.options.autoPreventDefault
            );

            // Add canvas to container (v8 uses .canvas instead of .view)
            var canvasElement = renderer.canvas || renderer.view;
            container.appendChild(canvasElement);
            _layer._rendererReady = true;

            if (_layer._zoomAnimated) {
              L.DomUtil.addClass(container, "leaflet-zoom-animated");
              _layer._setContainerStyle();
            }

            if (_layer._doubleBuffering) {
              // Create auxiliary renderer for double buffering
              return createRendererAsync(_layer._rendererOptions);
            }

            return null;
          } catch (error) {
            console.error(
              "Pixi.js v8 main renderer initialization failed:",
              error
            );
            throw error;
          }
        })
        .then(function (auxRenderer) {
          if (auxRenderer) {
            try {
              _layer._auxRenderer = auxRenderer;
              setEventSystem(
                _layer._auxRenderer,
                _layer.options.destroyInteractionManager,
                _layer.options.autoPreventDefault
              );
              var auxCanvas = auxRenderer.canvas || auxRenderer.view;
              container.appendChild(auxCanvas);
              _layer._renderer.canvas.style.position = "absolute";
              auxCanvas.style.position = "absolute";
            } catch (error) {
              console.error(
                "Pixi.js v8 auxiliary renderer initialization failed:",
                error
              );
            }
          }

          _layer._completeInitialization();
        })
        .catch(function (error) {
          console.error("Pixi.js v8 renderer initialization failed:", error);
          _layer._handleRendererError(error);
        });
    },

    // Sync renderer initialization for v7 and earlier
    _initializeRendererSync: function (container) {
      this._renderer = PIXI.autoDetectRenderer(this._rendererOptions);
      setEventSystem(
        this._renderer,
        this.options.destroyInteractionManager,
        this.options.autoPreventDefault
      );
      container.appendChild(this._renderer.view || this._renderer.canvas);

      if (this._zoomAnimated) {
        L.DomUtil.addClass(container, "leaflet-zoom-animated");
        this._setContainerStyle();
      }

      if (this._doubleBuffering) {
        this._auxRenderer = PIXI.autoDetectRenderer(this._rendererOptions);
        setEventSystem(
          this._auxRenderer,
          this.options.destroyInteractionManager,
          this.options.autoPreventDefault
        );
        container.appendChild(
          this._auxRenderer.view || this._auxRenderer.canvas
        );
        this._renderer.view.style.position = "absolute";
        this._auxRenderer.view.style.position = "absolute";
      }

      this._rendererReady = true;
    },

    // Complete overlay initialization
    _completeInitialization: function () {
      var map = this._map;
      this._initialZoom = this.options.projectionZoom(map);
      this._wgsOrigin = L.latLng([0, 0]);
      this._wgsInitialShift = map.project(this._wgsOrigin, this._initialZoom);
      this._mapInitialZoom = map.getZoom();
      var _layer = this;

      this.utils = {
        latLngToLayerPoint: function (latLng, zoom) {
          zoom = zoom === undefined ? _layer._initialZoom : zoom;
          var projectedPoint = map.project(L.latLng(latLng), zoom);
          return projectedPoint;
        },
        layerPointToLatLng: function (point, zoom) {
          zoom = zoom === undefined ? _layer._initialZoom : zoom;
          var projectedPoint = L.point(point);
          return map.unproject(projectedPoint, zoom);
        },
        getScale: function (zoom) {
          if (zoom === undefined)
            return map.getZoomScale(map.getZoom(), _layer._initialZoom);
          else return map.getZoomScale(zoom, _layer._initialZoom);
        },
        getRenderer: function () {
          return _layer._renderer;
        },
        // v8.10.0+ WebGL state management for better integration
        resetWebGLState: function () {
          if (_layer._renderer && _layer._renderer.resetState) {
            try {
              _layer._renderer.resetState();
            } catch (error) {
              console.warn("WebGL resetState failed:", error);
            }
          }
        },
        getContainer: function () {
          return _layer._pixiContainer;
        },
        getMap: function () {
          return _layer._map;
        },
      };
      this._rendererReady = true;
      this._update({ type: "add" });
    },

    onRemove: function () {
      L.DomUtil.remove(this._container);
    },

    getEvents: function () {
      var events = {
        zoom: this._onZoom,
        move: this._onMove,
        moveend: this._update,
      };
      if (this._zoomAnimated) {
        events.zoomanim = this._onAnimZoom;
      }
      return events;
    },

    _onZoom: function () {
      // Safety check: only update transform if initialization is complete
      if (this._center && this._zoom !== undefined) {
        this._updateTransform(this._map.getCenter(), this._map.getZoom());
      }
    },

    _onAnimZoom: function (e) {
      // Safety check: only update transform if initialization is complete
      if (this._center && this._zoom !== undefined) {
        this._updateTransform(e.center, e.zoom);
      }
    },

    _onMove: function (e) {
      if (this.options.shouldRedrawOnMove(e)) {
        this._update(e);
      }
    },

    _updateTransform: function (center, zoom) {
      // Safety check: _center may be undefined during initialization
      if (!this._center || !this._zoom) {
        return;
      }

      var scale = this._map.getZoomScale(zoom, this._zoom),
        viewHalf = this._map.getSize().multiplyBy(0.5 + this.options.padding),
        currentCenterPoint = this._map.project(this._center, zoom),
        topLeftOffset = viewHalf
          .multiplyBy(-scale)
          .add(currentCenterPoint)
          .subtract(this._map._getNewPixelOrigin(center, zoom));

      if (L.Browser.any3d) {
        L.DomUtil.setTransform(this._container, topLeftOffset, scale);
      } else {
        L.DomUtil.setPosition(this._container, topLeftOffset);
      }
    },

    _redraw: function (offset, e) {
      this._disableLeafletRounding();
      var scale = this._map.getZoomScale(this._zoom, this._initialZoom),
        shift = this._map
          .latLngToLayerPoint(this._wgsOrigin)
          ._subtract(this._wgsInitialShift.multiplyBy(scale))
          ._subtract(offset);
      this._pixiContainer.scale.set(scale);
      this._pixiContainer.position.set(shift.x, shift.y);
      this._drawCallback(this.utils, e);
      this._enableLeafletRounding();
    },

    _update: function (e) {
      // Check if renderer is ready (important for async initialization)
      if (!this._renderer || !this._rendererReady) {
        return;
      }

      // is this really useful?
      if (this._map._animatingZoom && this._bounds) {
        return;
      }

      // Update pixel bounds of renderer container
      var p = this.options.padding,
        mapSize = this._map.getSize(),
        min = this._map
          .containerPointToLayerPoint(mapSize.multiplyBy(-p))
          .round();

      this._bounds = new L.Bounds(
        min,
        min.add(mapSize.multiplyBy(1 + p * 2)).round()
      );
      this._center = this._map.getCenter();
      this._zoom = this._map.getZoom();

      if (this._doubleBuffering) {
        var currentRenderer = this._renderer;
        this._renderer = this._auxRenderer;
        this._auxRenderer = currentRenderer;
      }

      // Handle both v7 (.view) and v8 (.canvas) renderer properties
      var view = this._renderer.canvas || this._renderer.view;
      var b = this._bounds,
        container = this._container,
        size = b.getSize();

      if (
        !this._renderer.size ||
        this._renderer.size.x !== size.x ||
        this._renderer.size.y !== size.y
      ) {
        if (this._renderer.gl) {
          this._renderer.resolution = this.options.resolution;
          if (this._renderer.rootRenderTarget) {
            this._renderer.rootRenderTarget.resolution =
              this.options.resolution;
          }
        }
        this._renderer.resize(size.x, size.y);
        if (view) {
          view.style.width = size.x + "px";
          view.style.height = size.y + "px";
        }
        if (this._renderer.gl) {
          var gl = this._renderer.gl;
          if (gl.drawingBufferWidth !== this._renderer.width) {
            var resolution =
              (this.options.resolution * gl.drawingBufferWidth) /
              this._renderer.width;
            this._renderer.resolution = resolution;
            if (this._renderer.rootRenderTarget) {
              this._renderer.rootRenderTarget.resolution = resolution;
            }
            this._renderer.resize(size.x, size.y);
          }
        }
        this._renderer.size = size;
      }

      if (this._doubleBuffering) {
        var self = this;
        requestAnimationFrame(function () {
          self._redraw(b.min, e);
          self._renderer.gl.finish();
          view.style.visibility = "visible";
          self._auxRenderer.view.style.visibility = "hidden";
          L.DomUtil.setPosition(container, b.min);
        });
      } else {
        this._redraw(b.min, e);
        L.DomUtil.setPosition(container, b.min);
      }
    },

    _disableLeafletRounding: function () {
      L.Point.prototype._round = no_round;
    },

    _enableLeafletRounding: function () {
      L.Point.prototype._round = round;
    },

    redraw: function (data) {
      if (this._map) {
        this._disableLeafletRounding();
        this._drawCallback(this.utils, data);
        this._enableLeafletRounding();
      }
      return this;
    },

    _destroy: function () {
      // Enhanced cleanup for v8.12.0+ memory management improvements
      if (this._renderer) {
        this._renderer.destroy(true);
        this._renderer = null;
      }
      if (this._doubleBuffering && this._auxRenderer) {
        this._auxRenderer.destroy(true);
        this._auxRenderer = null;
      }

      // v8.12.0+ WorkerManager cleanup if available
      if (
        typeof PIXI.WorkerManager !== "undefined" &&
        PIXI.WorkerManager.reset
      ) {
        try {
          PIXI.WorkerManager.reset();
        } catch (error) {
          console.warn("WorkerManager reset failed:", error);
        }
      }

      // Clear references for better garbage collection
      this._pixiContainer = null;
      this._drawCallback = null;
      this.utils = null;
      this._rendererPromise = null;
    },

    destroy: function () {
      this.remove();
      this._destroy();
    },
  };

  if (L.version >= "1") {
    L.PixiOverlay = L.Layer.extend(pixiOverlayClass);
  } else {
    // backport some leaflet@1.0.0 methods
    L.Map.prototype.getZoomScale = function (toZoom, fromZoom) {
      var crs = this.options.crs;
      fromZoom = fromZoom === undefined ? this._zoom : fromZoom;
      return crs.scale(toZoom) / crs.scale(fromZoom);
    };

    L.DomUtil.setTransform = function (el, offset, scale) {
      var pos = offset || new L.Point(0, 0);

      el.style[L.DomUtil.TRANSFORM] =
        (L.Browser.ie3d
          ? "translate(" + pos.x + "px," + pos.y + "px)"
          : "translate3d(" + pos.x + "px," + pos.y + "px,0)") +
        (scale ? " scale(" + scale + ")" : "");
    };

    // patch pixiOverlayClass for leaflet@0.7.7
    pixiOverlayClass.includes = L.Mixin.Events;

    pixiOverlayClass.addTo = function (map) {
      map.addLayer(this);
      return this;
    };

    pixiOverlayClass._setMap = function (map) {
      this._map = map;
      this._zoomAnimated = map._zoomAnimated;
    };

    pixiOverlayClass._setContainerStyle = function () {
      var self = this;
      [
        "-webkit-transform-origin",
        "-ms-transform-origin",
        "transform-origin",
      ].forEach(function (property) {
        self._container.style[property] = "0 0";
      });
    };

    pixiOverlayClass._addContainer = function () {
      this._map
        .getPanes()
        [this.options.pane || "overlayPane"].appendChild(this._container);
    };

    pixiOverlayClass._setEvents = function () {
      var events = this.getEvents();
      for (var evt in events) {
        this._map.on(evt, events[evt], this);
      }
    };

    pixiOverlayClass.onRemove = function () {
      this._map = null;
      var parent = this._container.parentNode;
      if (parent) {
        parent.removeChild(this._container);
      }
      var events = this.getEvents();
      for (var evt in events) {
        this._map.off(evt, events[evt], this);
      }
    };

    pixiOverlayClass._completeInitialization = function () {
      if (!this._renderer) {
        console.warn("Cannot complete initialization: renderer not ready");
        return;
      }

      this._rendererReady = true;
      if (this._deferredUpdate) {
        this._deferredUpdate();
        this._deferredUpdate = null;
      }
      this._frame = null;
      this._update();
    };

    pixiOverlayClass._handleRendererError = function (error) {
      console.error("PixiOverlay renderer error:", error);
      // Fallback to sync initialization or basic canvas
      this._renderer = null;
      this._rendererReady = false;

      // Attempt fallback sync initialization if error occurred
      if (this._container && !this._renderer) {
        try {
          console.warn("Attempting fallback sync renderer initialization...");
          this._initializeRendererSync(this._container);
        } catch (fallbackError) {
          console.error(
            "Fallback renderer initialization also failed:",
            fallbackError
          );
        }
      }
    };

    pixiOverlayClass.destroy = function () {
      var map = this._map || this._mapToAdd;
      if (map) {
        map.removeLayer(this);
      }
      this._destroy();
    };

    L.PixiOverlay = L.Class.extend(pixiOverlayClass);
  }

  // @factory L.pixiOverlay(drawCallback: function, pixiContainer: PIXI.Container, options?: L.PixiOverlay options)
  // Creates a PixiOverlay with the given arguments.
  L.pixiOverlay = function (drawCallback, pixiContainer, options) {
    return L.Browser.canvas
      ? new L.PixiOverlay(drawCallback, pixiContainer, options)
      : null;
  };

  // @factory L.pixiOverlayAsync(drawCallback: function, pixiContainer: PIXI.Container, options?: L.PixiOverlay options)
  // Creates a PixiOverlay with async initialization (v8+ compatible). Returns a Promise.
  L.pixiOverlayAsync = function (drawCallback, pixiContainer, options) {
    return new Promise(function (resolve, reject) {
      if (!L.Browser.canvas) {
        reject(new Error("Canvas not supported"));
        return;
      }

      var overlay = new L.PixiOverlay(drawCallback, pixiContainer, options);

      // If using v8+ async initialization, wait for renderer
      if (overlay._needsAsyncInit && overlay._rendererPromise) {
        overlay._rendererPromise
          .then(function () {
            resolve(overlay);
          })
          .catch(function (error) {
            reject(error);
          });
      } else {
        // Sync initialization completed immediately
        resolve(overlay);
      }
    });
  };
});
