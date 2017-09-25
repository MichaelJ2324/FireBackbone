(function(factory) {

    // Establish the root object, `window` (`self`) in the browser, or `global` on the server.
    // We use `self` instead of `window` for `WebWorker` support.
    var root = (typeof self == 'object' && self.self === self && self) ||
        (typeof global == 'object' && global.global === global && global);

    // Set up Backbone appropriately for the environment. Start with AMD.
    if (typeof define === 'function' && define.amd) {
        define(['underscore', 'backbone', 'exports'], function(_, Backbone, exports) {
            // Export global even in AMD case in case this script is loaded with
            // others that may still expect a global Backbone.
            root.FirebaseDBackbone = factory(root, exports, _, Backbone);
        });

        // Next for Node.js or CommonJS. jQuery may not be needed as a module.
    } else if (typeof exports !== 'undefined') {
        var _ = require('underscore'),
            Backbone = require('backbone');
        factory(root, exports, _,Backbone);

        // Finally, as a browser global.
    } else {
        root.FirebaseDBackbone = factory(root, {}, root._, root.Backbone);
    }

})(function(root, FirebaseDBackbone, _,Backbone) {

    // Initial Setup
    // -------------

    // Save the previous value of the `Backbone` variable, so that it can be
    // restored later on, if `noConflict` is used.
    var previousFirebaseDBackbone = root.FirebaseDBackbone;

    //VERSION
    FirebaseDBackbone.VERSION = '0.2.7';

    // Runs FirebaseDBackbone.js in *noConflict* mode, returning the `FirebaseDBackbone` variable
    // to its previous owner. Returns a reference to this Backbone object.
    FirebaseDBackbone.noConflict = function() {
        root.FirebaseDBackbone = previousFirebaseDBackbone;
        return this;
    };

    //Use the global firebase object (call firebase)
    FirebaseDBackbone.firebaseApp = function(app) {
        if (_.isUndefined(app)){
            if (!_.isUndefined(firebase)){
                this._firebase = firebase.app();
            }else{
                throw new Error('No Firebase Application present');
            }
        }else{
            this._firebase = app;
        }
        return this._firebase;
    };

    /**
     * A utility for retrieving the key name of a Firebase ref or
     * DataSnapshot. This is backwards-compatible with `name()`
     * from Firebase 1.x.x and `key()` from Firebase 2.0.0+. Once
     * support for Firebase 1.x.x is dropped in BackboneFire, this
     * helper can be removed.
     */
    var _getKey = function (refOrSnapshot) {
        return refOrSnapshot.key;
    };

    /**
     * A utility for resolving whether an item will have the autoSync
     * property. Models can have this property on the prototype.
     */
    var _determineAutoSync = function (model, options) {
        var proto = Object.getPrototypeOf(model);
        return _.extend({
                autoSync: proto.hasOwnProperty('_autoSync') ? proto._autoSync : true
            },
            this,
            options
        )._autoSync;
    };

    /**
     * Determine the Firebase Application to be used
     * @param model
     * @param options
     */
    var _determineDatabase = function (model, options) {
        var proto = Object.getPrototypeOf(model);
        var defaultDB = null;
        var app = FirebaseDBackbone.firebaseApp();
        if (!_.isUndefined(app) && !_.isNull(app)){
            defaultDB = app.database();
        }
        return _.extend(
            {
                database: proto.hasOwnProperty('database') ? proto.database : defaultDB
            },
            this,
            options
        ).database;
    };

    var _onCompleteCheck = function (err, item, options) {
        if (!options) {
            return;
        }

        if (err && options.error) {
            options.error(item, err, options);
        } else if (options.success) {
            options.success(item, null, options);
        }
    };

    /**
     * Overriding of Backbone.sync.
     * All Backbone crud calls (destroy, add, create, save...) will pipe into
     * this method. This way Backbone can handle the prepping of the models
     * and the trigering of the appropiate methods. While sync can be overwritten
     * to handle updates to Firebase.
     */
    FirebaseDBackbone.sync = function (method, model, options) {
        var modelJSON = model.toJSON();

        if (method === 'read') {
            return model.ref(true).once('value',function(snap){
                var resp = snap.val();
                if (options.success) {
                    options.success(resp);
                }
            }, function(err) {
                if (options.error) {
                    options.error(err);
                }
            }, model);
        } else if (method === 'create') {
            return model.ref(true).set(modelJSON, function (err) {
                _onCompleteCheck(err, modelJSON, options);
            });
        } else if (method === 'update') {
            return model.ref(true).update(modelJSON,function(err){
                _onCompleteCheck(err, modelJSON, options);
            });
        } else if (method === 'delete') {
            return model.ref(true).set(null, function (err) {
                _onCompleteCheck(err, modelJSON, options);
            });
        }

    };

    /**
     * A utility for throwing errors.
     */
    var _throwError = function (message) {
        throw new Error(message);
    };


    /**
     * A utility for assigning an id from a snapshot.
     *    object    - Assign id from snapshot key
     *    primitive - Throw error, primitives cannot be synced
     *    null      - Create blank object and assign id
     */
    var _checkId = function (snap, idAttribute) {
        var model = snap.val();
        // if the model is a primitive throw an error
        if (_isPrimitive(model)) {
            _throwError('InvalidIdException: Models must have an Id. Note: You may ' +
                'be trying to sync a primitive value (int, string, bool).');
        }

        // if the model is null set it to an empty object and assign its id
        // this way listeners can still be attached to populate the object in the future
        if (model === null) {
            model = {};
        }

        // set the id to the snapshot's key
        model[idAttribute] = _getKey(snap);

        return model;
    };

    /**
     * A utility for checking if a value is a primitive
     */
    var _isPrimitive = function (value) {
        // is the value not an object and not null (basically, is it a primitive?)
        return !_.isObject(value) && value !== null;
    };

    var Model = FirebaseDBackbone.Model = Backbone.Model.extend({

        // Determine whether the realtime or once methods apply
        initialize: function (model, options) {
            this.autoSync(_determineAutoSync(this, options));

            this.database = _determineDatabase(this, options);

            var defaults = _.result(this, 'defaults');

            // Apply defaults only after first sync.
            this.once('sync', function () {
                this.set(_.defaults(this.toJSON(), defaults));
            });
        },

        autoSync: function(autoSync){
            if (!_.isUndefined(autoSync)){
                if (autoSync !== this._autoSync){
                    if (autoSync === false){
                        this._closeRef();
                        this.off('change',this._autoSyncListeners.change);
                        this.off('destroy',this._autoSyncListeners.destroy);
                    }else{
                        this._listenLocalChanges();
                    }
                }
                this._autoSync = autoSync;
            }
            return this._autoSync;
        },

        ref: function (refresh) {
            refresh = refresh || false;
            if (_.isUndefined(this._ref) || refresh === true) {
                this._closeRef();
                this._setRef(this.url());
                this._configureRef();
            }
            return this._ref;
        },

        _setRef: function (url) {
            switch (typeof url) {
                case 'object':
                    this._ref = url;
                    break;
                case 'string':
                    this._ref = this._buildRef(url);
                    break;
                default:
                    _throwError('Invalid type returned from url method');
            }
            return this._ref;
        },

        _buildRef: function (url) {
            var re = /https:\/\/.*\.firebaseio\.com/i
            if (url.match(re)) {
                return this.database.refFromURL(url);
            } else {
                return this.database.ref(url);
            }
        },

        _configureRef: function(){
            if (this.autoSync()){
                this._ref.on('value',this._setLocal,function(err){
                    this.trigger('FirebaseDBackbone:error',this,err,'value');
                },this);
            }
        },

        _closeRef: function(){
            if (!_.isUndefined(this._ref)){
                this._ref.off('value',this._setLocal,this);
            }
        },

        _autoSyncListeners: {
            change: _.bind(function(model,options){
                if (model.autoSync()){
                    if (model.hasChanged(model.idAttribute)){
                        model.ref(true);
                    }
                    model.save();
                }
            },this),
            destroy: _.bind(function(model,options){
                if (model.autoSync()) {
                    model.ref(true);
                }
            },this)
        },

        _listenLocalChanges: function(){
            this.on('change',this._autoSyncListeners.change);
            this.on('destroy',this._autoSyncListeners.destroy);
        },

        sync: function (method, model, options) {
            FirebaseDBackbone.sync(method, model, options);
        },

        /**
         * Proccess changes from a snapshot and apply locally
         * Always apply it silently
         */
        _setLocal: function (snap) {
            var newModel = this._unsetAttributes(snap);
            var options = {
                silent: true
            };
            this.set(newModel, options);
        },

        /**
         * Unset attributes that have been deleted from the server
         * by comparing the keys that have been removed.
         */
        _unsetAttributes: function (snap) {
            var newModel = _checkId(snap, this.idAttribute);

            if (typeof newModel === 'object' && newModel !== null) {
                var diff = _.difference(_.keys(this.attributes), _.keys(newModel));
                _.each(diff, function (key) {
                    this.unset(key);
                },this);
            }

            // check to see if it needs an id
            this._setId(snap);

            return newModel;
        },

        /**
         * Siliently set the id of the model to the snapshot key
         */
        _setId: function (snap) {
            if (this.isNew()) {
                this.set(this.idAttribute, _getKey(snap), {silent: true});
            }
        },

        /**
         * Find the deleted keys and set their values to null
         * so Firebase properly deletes them.
         */
        _updateModel: function (model) {
            var modelObj = model.changedAttributes();
            _.each(model.changed, function (value, key) {
                //Don't submit IDs in Model as it exists in reference
                if (key == model.idAttribute) {
                    delete modelObj[key];
                }
                if (typeof value === 'undefined' || value === null) {
                    modelObj[key] = null;
                }
            });

            return modelObj;
        }

    });



    var OnceCollection = (function () {
        function OnceCollection() {

        }

        OnceCollection.protoype = {
            /**
             * Create an id from a Firebase push-id and call Backbone.create, which
             * will do prepare the models and trigger the proper events and then call
             * Backbonefire.sync with the correct method.
             */
            create: function (model, options) {
                var idAttr = this.idAttribute();
                model[idAttr] = model[idAttr] || _getKey(this.ref().push());
                options = _.extend({_autoSync: false}, options);
                return Backbone.Collection.prototype.create.call(this, model, options);
            },
            /**
             * Create an id from a Firebase push-id and call Backbone.add, which
             * will do prepare the models and trigger the proper events and then call
             * Backbonefire.sync with the correct method.
             */
            add: function (model, options) {
                var idAttr = this.idAttribute();
                model[idAttr] = model[idAttr] || _getKey(this.ref().push());
                options = _.extend({_autoSync: false}, options);
                return Backbone.Collection.prototype.add.call(this, model, options);
            },
            /**
             * Proxy to Backbonefire.sync
             */
            sync: function (method, model, options) {
                FirebaseDBackbone.sync(method, model, options);
            },
            /**
             * Firebase returns lists as an object with keys, where Backbone
             * collections require an array. This function modifies the existing
             * Backbone.Collection.fetch method by mapping the returned object from
             * Firebase to an array that Backbone can use.
             */
            fetch: function (options) {
                options = options ? _.clone(options) : {};
                if (options.parse === void 0) {
                    options.parse = true;
                }
                var success = options.success;
                var collection = this;
                options.success = function (resp) {
                    var arr = [];
                    var keys = _.keys(resp);
                    _.each(keys, function (key) {
                        arr.push(resp[key]);
                    });
                    var method = options.reset ? 'reset' : 'set';
                    collection[method](arr, options);
                    if (success) {
                        success(collection, arr, options);
                    }
                    options.autoSync = false;
                    options.url = this.url;
                    collection.trigger('sync', collection, arr, options);
                };
                return this.sync('read', this, options);
            },

        };

        return OnceCollection;
    }());

    var SyncCollection = (function () {

        function SyncCollection() {

            // Handle changes in any local models.
            this.listenTo(this, 'change', this._updateModel, this);
            // Listen for destroy event to remove models.
            this.listenTo(this, 'destroy', this._removeModel, this);
        }

        SyncCollection.protoype = {
            add: function (models, options) {
                // prepare models
                var parsed = this._parseModels(models);
                options = options ? _.clone(options) : {};
                options.success = _.isFunction(options.success) ? options.success : function () {};

                for (var i = 0; i < parsed.length; i++) {
                    var model = parsed[i];

                    if (options.silent === true) {
                        this._suppressEvent = true;
                    }

                    // XXX model prototype broken: this.model.prototype.idAttribute worked around as this.idAttribute
                    var childRef = this.ref().child(model[this.idAttribute]);
                    childRef.set(model, _.bind(options.success, model));
                }

                return parsed;
            },

            create: function (model, options) {
                options = options ? _.clone(options) : {};
                if (options.wait) {
                    this._log('Wait option provided to create, ignoring.');
                }
                if (!model) {
                    return false;
                }
                var set = this.add([model], options);
                return set[0];
            },

            remove: function (models, options) {
                var parsed = this._parseModels(models);
                options = options ? _.clone(options) : {};
                options.success =
                    _.isFunction(options.success) ? options.success : function () {
                    };

                for (var i = 0; i < parsed.length; i++) {
                    var model = parsed[i];
                    // XXX model prototype broken: this.model.prototype.idAttribute worked around as this.idAttribute
                    var childRef = this.ref().child(model[this.idAttribute()]);
                    if (options.silent === true) {
                        this._suppressEvent = true;
                    }
                    _setWithCheck(childRef, null, options);
                }

                return parsed;
            },

            reset: function (models, options) {
                options = options ? _.clone(options) : {};
                // Remove all models remotely.
                this.remove(this.models, {silent: true});
                // Add new models.
                var ret = this.add(models, {silent: true});
                // Trigger 'reset' event.
                if (!options.silent) {
                    this.trigger('reset', this, options);
                }
                return ret;
            },

            // This function does not actually fetch data from the server.
            // Rather, the "sync" event is fired when data has been loaded
            // from the server. Since the _initialSync property will indicate
            // whether the initial load has occurred, the "sync" event can
            // be fired once _initialSync has been resolved.
            fetch: function (options) {
                options = _.extend({parse: true}, options);
                var success = options.success;
                var collection = this;
                if (this.autoSync()){
                    if (options.reset || _.isNull(this._ref)) {
                        this.ref(true);
                        this._ref.on('child_added',this._childAdded,function(err){
                            this.trigger("FirebaseDBackbone:error",this,err,'child_added');
                        },this);
                        this._ref.on('child_moved',this._childMoved,function(err){
                            this.trigger("FirebaseDBackbone:error",this,err,'child_moved');
                        },this);
                        this._ref.on('child_changed',this._childChanged,function(err){
                            this.trigger("FirebaseDBackbone:error",this,err,'child_changed');
                        },this);
                        this._ref.on('child_removed',this._childRemoved,function(err){
                            this.trigger("FirebaseDBackbone:error",this,err,'child_removed');
                        },this);
                    }
                }
                this.ref().once('value', function (){
                    if (success) success.call(options.context, this, options);
                    this.trigger('sync', this, null, null);
                }, function (err) {
                    this.trigger('FirebaseDBackbone:error', this, err, 'value');
                }, this);
            },


            _log: function (msg) {
                if (console && console.log) {
                    console.log(msg);
                }
            },

            _parseModels: function (models, options) {
                var pushArray = [];
                // check if the models paramter is an array or a single object
                var singular = !_.isArray(models);
                // if the models parameter is a single object then wrap it into an array
                models = singular ? (models ? [models] : []) : models.slice();

                var idAttr = this.idAttribute();
                for (var i = 0; i < models.length; i++) {
                    var model = models[i];

                    model[idAttr] = model[idAttr] || _getKey(this.ref().push());

                    // call Backbone's prepareModel to apply options
                    model = Backbone.Collection.prototype._prepareModel.call(
                        this, model, options
                    );

                    if (model.toJSON && typeof model.toJSON == 'function') {
                        model = model.toJSON();
                    }

                    pushArray.push(model);

                }

                return pushArray;
            },

            _childAdded: function (snap) {
                var model = _checkId(snap, this.idAttribute());

                if (this._suppressEvent === true) {
                    this._suppressEvent = false;
                    Backbone.Collection.prototype.add.call(this, [model], {silent: true});
                } else {
                    Backbone.Collection.prototype.add.call(this, [model]);
                }
                this.get(model[this.idAttribute])._remoteAttributes = model;
            },

            // TODO: child_moved is emitted when the priority for a child is changed, so it
            // should update the priority of the model and maybe trigger a sort
            _childMoved: function () {

            },

            // when a model has changed remotely find differences between the
            // local and remote data and apply them to the local model
            _childChanged: function (snap) {
                // XXX model prototype broken: this.model.prototype.idAttribute worked around as this.idAttribute
                var idAttribute = this.idAttribute;
                var model = Backbonefire._checkId(snap, idAttribute);

                var item = _.find(this.models, function (child) {
                    return child.id == model[idAttribute];
                });

                if (!item) {
                    // TODO: Investigate: what is the right way to handle this case?
                    //throw new Error('Could not find model with ID ' + model.id);
                    this._childAdded(snap);
                    return;
                }

                this._preventSync(item, true);
                item._remoteAttributes = model;

                // find the attributes that have been deleted remotely and
                // unset them locally
                var diff = _.difference(_.keys(item.attributes), _.keys(model));
                _.each(diff, function (key) {
                    item.unset(key);
                });

                item.set(model);
                // fire sync since this is a response from the server
                this.trigger('sync', this);
                this._preventSync(item, false);
            },

            // remove an item from the collection when removed remotely
            // provides the ability to remove siliently
            _childRemoved: function (snap) {
                // XXX model prototype broken: this.model.prototype.idAttribute worked around as this.idAttribute
                var model = Backbonefire._checkId(snap, this.idAttribute);

                if (this._suppressEvent === true) {
                    this._suppressEvent = false;
                    Backbone.Collection.prototype.remove.call(
                        this, [model], {silent: true}
                    );
                } else {
                    // trigger sync because data has been received from the server
                    this.trigger('sync', this);
                    Backbone.Collection.prototype.remove.call(this, [model]);
                }
            },

            // Add handlers for all models in this collection, and any future ones
            // that may be added.
            _updateModel: function (model) {
                var remoteAttributes;
                var localAttributes;
                var updateAttributes;
                var ref;

                // if the model is already being handled by listeners then return
                if (model._remoteChanging) {
                    return;
                }

                remoteAttributes = model._remoteAttributes || {};
                localAttributes = model.toJSON();

                // consolidate the updates to Firebase
                updateAttributes = this._compareAttributes(remoteAttributes, localAttributes);

                ref = this.ref().child(model.id);

                // if '.priority' is present setWithPriority
                // else do a regular update
                if (_.has(updateAttributes, '.priority')) {
                    this._setWithPriority(ref, localAttributes);
                } else {
                    this._updateToFirebase(ref, localAttributes);
                }

            },

            // set the attributes to be updated to Firebase
            // set any removed attributes to null so that Firebase removes them
            _compareAttributes: function (remoteAttributes, localAttributes) {
                var updateAttributes = {};

                var union = _.union(_.keys(remoteAttributes), _.keys(localAttributes));

                _.each(union, function (key) {
                    if (!_.has(localAttributes, key)) {
                        updateAttributes[key] = null;
                    } else if (localAttributes[key] != remoteAttributes[key]) {
                        updateAttributes[key] = localAttributes[key];
                    }
                });

                return updateAttributes;
            },

            // Special case if '.priority' was updated - a merge is not
            // allowed so we'll have to do a full setWithPriority.
            _setWithPriority: function (ref, item) {
                var priority = item['.priority'];
                delete item['.priority'];
                ref.setWithPriority(item, priority);
                return item;
            },

            _updateToFirebase: function (ref, item) {
                ref.update(item);
            },

            // Triggered when model.destroy() is called on one of the children.
            _removeModel: function (model, collection, options) {
                options = options ? _.clone(options) : {};
                options.success =
                    _.isFunction(options.success) ? options.success : function () {
                    };
                var childRef = this.ref().child(model.id);
                _setWithCheck(childRef, null, _.bind(options.success, model));
            },

            _preventSync: function (model, state) {
                model._remoteChanging = state;
            },

        };

        return SyncCollection;
    }());

    var Collection = FirebaseDBackbone.Collection = Backbone.Collection.extend({

        model: Model,

        initialize: function (models, options) {
            var self = this;
            var BaseModel = self.model;

            this._autoSync = _determineAutoSync(BaseModel,options);

            this.database = _determineDatabase(this, options);

            if (!this._autoSync) {
                _.extend(this, OnceCollection.protoype);
                OnceCollection.apply(this, arguments);
            } else {
                _.extend(this, SyncCollection.protoype);
                SyncCollection.apply(this, arguments);
            }
        },

        idAttribute: function(){
            return this.model.prototype.idAttribute || 'id';
        },

        ref: function (refresh) {
            refresh = refresh || false;
            if (_.isUndefined(this._ref) || refresh === true) {
                this._setRef();
            }
            return this._ref;
        },

        _setRef: function () {
            var url = null;
            switch (typeof this.url) {
                case 'function':
                    url = this.url();
                    break;
                case 'object':
                    url = this.url;
                    break;
                case 'string':
                    url = this.url;
                    break;
                default:
                    _throwError('Invalid type passed to url property');
            }
            switch (typeof url) {
                case 'object':
                    this._ref = this.url;
                    break;
                case 'string':
                    this._ref = this._buildRef(url);
                    break;
                default:
                    _throwError('Invalid type passed to url property');
            }
            this._configureRef();
        },

        _buildRef: function (url) {
            var re = /https:\/\/.*\.firebaseio\.com/
            if (url.match(re)) {
                return this.database.refFromURL(url);
            } else {
                return this.database.ref(url);
            }
        }

    });

    return FirebaseDBackbone;

});


