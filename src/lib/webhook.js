"use strict";

const _ = require("lodash");
const EventEmitter = require("events").EventEmitter;
const request = require("request-promise");

/**
 * Use the change method to automatically send necessary webhooks
 * @param {object} options - Object of parameters (url, isRollback)
 * @fires Webhook#done
 * @fires Webhook#info
 * @fires Webhook#error
 */
class Webhook extends EventEmitter {
	constructor(options) {
		super();
		this.options = _.merge({
			urls: [],
			isRollback: false
		}, options);
		this.manifests = {};
		this.clusters = [];
		if (!this.options.urls.length) {
			throw new Error("Must provide at least 1 url");
		}

		this._sentPromise = new Promise((resolve, reject) => {
			this.on("done", (err) => {
				if (!err) {
					resolve();
				} else {
					reject(err);
				}
			});
		});
	}

	send(name, phase, status) {
		const payload = {
			// TODO: dynamic name for payload?
			name: "kubernetes-deploy",
			url: undefined,
			provider: "CodeShip/Kubernetes",
			build: {
				full_url: undefined,
				number: undefined,
				queue_id: undefined,
				phase: phase,
				status: status,
				url: undefined,
				scm: {
					url: undefined,
					branch: undefined,
					commit: undefined
				},
				parameters: {
					REVERT: (this.options.isRollback) ? "true" : "false",
					hash: undefined,
					jobID: undefined,
					CHEFNODE: undefined,
					BRANCH: undefined
				},
				log: undefined,
				artifacts: {}
			}
		};

		// TODO: we should not have to append the "name" to the url
		const promises = [];
		_.each(this.options.urls, (url) => {
			const urlWithService = url + "/" + name;
			this.emit("info", "Sending payload to " + urlWithService + " for " + name + " with status " + phase + "/" + status);
			promises.push(request({
				method: "POST",
				uri: urlWithService,
				body: payload,
				json: true
			}).then((res) => {
				this.emit("info", "Successfully sent payload to " + urlWithService + " for " + name + " with status " + phase + "/" + status);
				return res;
			}).catch((err) => {
				// TODO: webhook can silently fail (only printing the error message and not causing a "failed" deploy because we don't wait for the webhook to finish)
				this.emit("error", err);
			}));
		});
		return Promise.all(promises);
	}

	// TODO: this is a bit yucky, would like to remove it as it's specific to our use-case
	getServiceName(status) {
		const serviceNameKey = "kit-deployer/service-name";
		return (_.has(status.manifest, ["metadata", "annotations", serviceNameKey])) ? status.manifest.metadata.annotations[serviceNameKey] : status.manifest.metadata.name;
	}

	// Call this method whenever there is a status update to check if the
	// deployment was successful or not. It will automatically send a payload to
	// the webhook once the deployment is finished with all clusters.
	change(status) {
		if (status.kind === "Cluster") {
			switch (status.phase) {
				case "STARTED":
					this.clusters.push(status);
					break;
				case "COMPLETED":
					this.clusters = _.reject(this.clusters, {name: status.name});
					break;
				default:
					this.emit("error", "Unknown phase for cluster: " + status.phase);
			}
			// If deployer is done and all clusters have completed
			if (this.clusters.length === 0) {
				const promises = [];
				_.each(this.manifests, (manifestStatus) => {
					const name = this.getServiceName(manifestStatus);
					promises.push(this.send(name, manifestStatus.phase, manifestStatus.status));
				});
				Promise
					.all(promises)
					.then(() => {
						this.emit("done", null);
					})
					.catch((err) => {
						this.emit("done", err);
					});
			}
		} else {
			const name = this.getServiceName(status);
			if (!this.manifests[name]) {
				// Always send the first status we receive for a manifest
				this.manifests[name] = status;
				this.send(name, status.phase, status.status);
			} else if (this.manifests[name].status !== "FAILURE") {
				// If the status is failure for any cluster, we consider the deployment as a whole a failure, so keep failure status
				this.manifests[name] = status;
			}
		}
	}

	sent() {
		return this._sentPromise;
	}
}

module.exports = Webhook;
