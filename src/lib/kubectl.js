"use strict";

const spawn = require("child_process").spawn;
const Promise = require("bluebird");
const EventEmitter = require("events").EventEmitter;
const diff = require("deep-diff");

class KubectlWatcher extends EventEmitter {
	constructor(kubectl, resource, name) {
		super();
		this.kubectl = kubectl;
		this.interval = 3 * 1000; // 3 second polling
		this.resource = resource;
		this.name = name;
		this._previousResult;

		// init
		this.start();
	}

	start() {
		this._timeoutId = setTimeout(() => {
			this.kubectl
				.get(this.resource, this.name)
				.then((result) => {
					// Only emit a change event if there was a change in the result
					if (diff(result, this._previousResult)) {
						this.emit("change", result);
					}
					this._previousResult = result;
				})
				.catch((err) => {
					this.emit("error", err);
				});
			this.start();
		}, this.interval);
	}

	stop() {
		clearTimeout(this._timeoutId);
		this.removeAllListeners();
	}
}

class Kubectl {
	constructor(conf) {
		this.binary = conf.binary || "kubectl";

		this.kubeconfig = conf.kubeconfig || "";
		this.endpoint = conf.endpoint || "";
	}

	spawn(args, done) {
		var ops = new Array();

		// Prefer configuration file over endpoint if both are defined
		if (this.kubeconfig) {
			ops.push("--kubeconfig");
			ops.push(this.kubeconfig);
		} else {
			ops.push("-s");
			ops.push(this.endpoint);
		}

		var kube = spawn(this.binary, ops.concat(args));
		var stdout = "";
		var stderr = "";

		kube.stdout.on("data", function(data) {
			stdout += data;
		});

		kube.stderr.on("data", function(data) {
			stderr += data;
		});

		kube.on("close", function(code) {
			if (!stderr) {
				stderr = undefined;
			}

			if (typeof done === "function") {
				done(stderr, stdout);
			}
		});

		return kube;
	}

	get(resource, name) {
		return new Promise((resolve, reject) => {
			this.spawn(["get", "--output=json", resource, name], (err, data) => {
				if (err) {
					return reject(err);
				}
				resolve(JSON.parse(data));
			});
		});
	}

	list(resource, selector) {
		return new Promise((resolve, reject) => {
			var args = ["get", "--output=json", resource];
			if (selector) {
				args.push("-l");
				args.push(selector);
			}
			this.spawn(args, (err, data) => {
				if (err) {
					return reject(err);
				}
				resolve(JSON.parse(data));
			});
		});
	}

	create(filepath) {
		return new Promise((resolve, reject) => {
			this.spawn(["create", "-f", filepath], function(err, data) {
				if (err) {
					return reject(err);
				}
				resolve(data);
			});
		});
	}

	recreate(filepath) {
		return this
			.delete(filepath)
			.then(() => {
				return new Promise((resolve, reject) => {
					this.spawn(["create", "-f", filepath], function(err, data) {
						if (err) {
							return reject(err);
						}
						resolve(data);
					});
				});
			});
	}

	delete(filepath) {
		return new Promise((resolve, reject) => {
			this.spawn(["delete", "-f", filepath], function(err, data) {
				if (err) {
					return reject(err);
				}
				resolve(data);
			});
		});
	}

	deleteByName(kind, name) {
		return new Promise((resolve, reject) => {
			this.spawn(["delete", kind, name], function(err, data) {
				if (err) {
					return reject(err);
				}
				resolve(data);
			});
		});
	}

	apply(filepath) {
		return new Promise((resolve, reject) => {
			this.spawn(["apply", "-f", filepath], function(err, data) {
				if (err) {
					return reject(err);
				}
				resolve(data);
			});
		});
	}

	/**
	 * Watches given resource and emits events on changes.
	 * @param {string} resource - A single resource type to watch
	 * @fires KubectlWatcher#change
	 * @fires KubectlWatcher#error
	 */
	watch(resource, name) {
		return new KubectlWatcher(this, resource, name);
	}
}

module.exports = Kubectl;
