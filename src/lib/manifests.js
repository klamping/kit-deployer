"use strict";

const _ = require("lodash");
const crypto = require("crypto");
const diff = require("deep-diff");
const fs = require("fs");
const glob = require("glob");
const Github = require("./github");
const Promise = require("bluebird");
const path = require("path");
const yaml = require("js-yaml");
const EventEmitter = require("events");
const Dependencies = require("./dependencies");
const Status = require("./status");
const writeFileAsync = Promise.promisify(fs.writeFile);
const supportedTypes = [
	"deployment",
	"service",
	"secret",
	"job",
	"daemonset",
	"persistentvolumeclaim"
];

const commitKey = "kit-deployer/commit";
const lastAppliedConfigurationKey = "kit-deployer/last-applied-configuration";
const lastAppliedConfigurationHashKey = "kit-deployer/last-applied-configuration-sha1";

class Manifests extends EventEmitter {
	constructor(options) {
		super();
		this.options = _.merge({
			sha: undefined,
			waitForAvailable: false,
			cluster: undefined,
			dir: undefined,
			selector: undefined,
			available: {
				enabled: false,
				keepAlive: false,
				keepAliveInterval: 30,
				required: false,
				timeout: 10 * 60 // 10 minutes
			},
			github: {
				enabled: true,
				token: undefined,
				user: undefined,
				repo: undefined
			},
			dependency: {
				wait: 3, // 3 seconds
				timeout: 10 * 60 // 10 minutes
			},
			kubectl: undefined
		}, options);
		this.kubectl = this.options.kubectl;

		this.manifests = this.load();
	}

	get supportedTypes() {
		return supportedTypes;
	}

	load() {
		var manifests = [];
		if (!this.options.dir) {
			return manifests;
		}
		var files = glob.sync(path.join(this.options.dir, this.options.clusterName + "/**/*.yaml"));
		_.each(files, (file) => {
			manifests.push({
				path: file,
				content: yaml.safeLoad(fs.readFileSync(file, "utf8"))
			});
		});
		return manifests;
	}

	/**
	 * Deploys the manifests to the cluster.
	 * @param {string} resource - A single resource type to watch
	 * @fires Manifests#info
	 * @fires Manifests#warning
	 * @fires Manifests#error
	 * @return {object} promise
	 */
	deploy() {
		return new Promise((resolve, reject) => {
			var availablePromises = [];
			var dependencies = new Dependencies({
				kubectl: this.kubectl
			});
			dependencies.on("info", (msg) => {
				this.emit("info", msg);
			});
			dependencies.wait = parseInt(this.options.dependency.wait);
			dependencies.timeout = parseInt(this.options.dependency.timeout);

			var status = new Status({
				keepAlive: this.options.available.keepAlive,
				keepAliveInterval: this.options.available.keepAliveInterval,
				timeout: this.options.available.timeout,
				kubectl: this.kubectl
			});
			status.on("info", (msg) => {
				this.emit("info", msg);
			});

			this.emit("status", {
				name: this.options.cluster.metadata.name,
				kind: "Cluster",
				phase: "STARTED",
				status: "IN_PROGRESS",
				manifest: this.options.cluster
			});

			var existing = [];

			if (this.options.selector) {
				this.emit("info", "Getting list of " + this.supportedTypes.join(",") + " matching '" + this.options.selector + "'");
			} else {
				this.emit("info", "Getting list of " + this.supportedTypes.join(","));
			}

			return this.kubectl
				.list(this.supportedTypes.join(","), this.options.selector)
				.then((results) => {
					this.emit("info", "Found " + results.items.length + " resources");
					existing = results.items;
				})
				.then(() => {
					var kubePromises = [];
					var promiseFuncsWithDependencies = [];
					var remaining = _.cloneDeep(existing);
					var manifestFiles = glob.sync(path.join(this.options.dir, this.options.cluster.metadata.name + "/**/*.yaml"));

					_.each(manifestFiles, (manifestFile) => {
						var manifest = yaml.safeLoad(fs.readFileSync(manifestFile, "utf8"));
						var differences = {};
						var method, lastAppliedConfiguration;

						var found = false;

						// Save configuration we're applying as metadata annotation so we can diff against
						// on future configuration changes
						var applyingConfiguration = JSON.stringify(manifest);
						var applyingConfigurationHash = crypto.createHash("sha1").update(applyingConfiguration, "utf8").digest("hex");

						// To avoid issues with deleting/creating jobs, we instead create a new job with a unique name that is based
						// on the contents of the manifest
						var manifestName = manifest.metadata.name;
						if (manifest.kind === "Job") {
							manifestName = manifest.metadata.name + "-" + applyingConfigurationHash;
						}

						// Only parse manifests that are supported
						if (this.supportedTypes.indexOf(manifest.kind.toLowerCase()) < 0) {
							this.emit("warning", "Skipping " + manifestName + " because " + manifest.kind + " is unsupported");
							return;
						}

						found = _.find(existing, {kind: manifest.kind, metadata: {name: manifestName}});
						remaining = _.reject(remaining, {kind: manifest.kind, metadata: {name: manifestName}});

						if (found) {
							// Handle updating Jobs/DaemonSets by deleting and recreating
							// Generally, we should never have a situtation where we are "updating" a job as we instead
							// create a new job if changes are detected, so this is here just to catch any odd case where
							// we need to recreate the job
							if (["DaemonSet", "Job"].indexOf(manifest.kind) >= 0) {
								method = "Recreate";
							} else {
								method = "Apply";
							}

							// Get the last applied configuration if one exists
							if (_.has(found, ["metadata", "annotations", lastAppliedConfigurationKey])) {
								var lastAppliedConfigurationString = found.metadata.annotations[lastAppliedConfigurationKey];
								lastAppliedConfiguration = JSON.parse(lastAppliedConfigurationString);
							}
							differences = diff(lastAppliedConfiguration, manifest);
							if (this.options.diff) {
								if (differences) {
									this.emit("info", "Differences for " + manifestName + ": " + JSON.stringify(differences, null, 2));
								}
							}
						} else {
							method = "Create";
						}

						if (differences || this.options.force) {
							var promiseFunc = () => {
								// Initialize annotations object if it doesn't have one yet
								if (!manifest.metadata) {
									manifest.metadata = {};
								}
								if (!manifest.metadata.annotations) {
									manifest.metadata.annotations = {};
								}

								// Skip deploying this manifest if it's newer than what we currently have to deploy
								var committerDate = null;
								if (_.has(found, ["metadata", "annotations", commitKey])) {
									var commitAnnotation = JSON.parse(found.metadata.annotations[commitKey]);
									if (_.has(commitAnnotation, ["commit", "committer", "date"])) {
										committerDate = new Date(commitAnnotation.commit.committer.date);
									}
								}

								// Only check github if it's enabled
								var skipCheck = Promise.resolve(false);
								if (this.options.github.enabled) {
									var github = new Github(this.options.github.token);
									skipCheck = github.getCommit(this.options.github.user, this.options.github.repo, this.options.sha)
										.then((res) => {
											if (committerDate && _.has(res, ["commit", "committer", "date"]) && committerDate.getTime() > new Date(res.commit.committer.date).getTime()) {
												this.emit("warning", "Skipping " + manifestName + " because cluster has newer commit");
												return true;
											}
											return false;
										});
								}

								return skipCheck
									.then((skip) => {
										// Skip the update
										if (skip) {
											return Promise.resolve();
										}

										// Update manifest name before deploying (necessary for manifests we need to give a unique name to like Jobs)
										manifest.metadata.name = manifestName;

										// Add our custom annotations before deploying
										var tmpApplyingConfigurationPath = path.join("/tmp", this.options.cluster.metadata.name + "-" + path.basename(manifestFile) + ".json");
										manifest.metadata.annotations[lastAppliedConfigurationKey] = applyingConfiguration;
										manifest.metadata.annotations[lastAppliedConfigurationHashKey] = applyingConfigurationHash;

										// Add commit annotation to manifest we are creating/updating
										manifest.metadata.annotations[commitKey] = JSON.stringify(this.options.sha);

										var generatedApplyingConfiguration = JSON.stringify(manifest);

										return writeFileAsync(tmpApplyingConfigurationPath, generatedApplyingConfiguration, "utf8")
											.then(() => {
												// Do a dry-run check for dependencies (basically don't wait for any dependencies, just check what
												// dependencies exists)
												var checkAvailable = false;
												if (!this.options.dryRun) {
													// Check if this manifest has any dependencies and if it does, wait for them to be available
													// before deploying it
													checkAvailable = true;
												}
												return dependencies.ready(manifest, checkAvailable);
											})
											.then(() => {
												this.emit("info", method + " " + manifest.metadata.name);
												if (!this.options.dryRun) {
													return this.kubectl[method.toLowerCase()](tmpApplyingConfigurationPath)
														.then((msg) => {
															this.emit("info", msg);
															this.emit("status", {
																cluster: this.options.cluster.metadata.name,
																name: manifestName,
																kind: manifest.kind,
																phase: "STARTED",
																status: "IN_PROGRESS",
																manifest: manifest
															});

															// Only check if resource is available if it's required
															if (this.options.available.enabled) {
																var availablePromise = status
																	.available(manifest.kind, manifestName)
																	.then(() => {
																		this.emit("status", {
																			cluster: this.options.cluster.metadata.name,
																			name: manifestName,
																			kind: manifest.kind,
																			phase: "COMPLETED",
																			status: "SUCCESS",
																			manifest: manifest
																		});
																	})
																	.catch((err) => {
																		this.emit("error", err);
																		this.emit("status", {
																			cluster: this.options.cluster.metadata.name,
																			name: manifestName,
																			kind: manifest.kind,
																			phase: "COMPLETED",
																			status: "FAILURE",
																			manifest: manifest
																		});
																	});
																availablePromises.push(availablePromise);
																// Wait for promise to resolve if we need to wait until available is successful
																if (this.options.available.required) {
																	return availablePromise;
																}
															}
														})
														.catch((err) => {
															this.emit("error", "Error running kubectl." + method.toLowerCase() + "('" + tmpApplyingConfigurationPath + "') " + err);
														});
												}
											});
									});
							};

							// If this manifest has NO dependencies, we will deploy it first
							if (!dependencies.find(manifest)) {
								kubePromises.push(promiseFunc());
							} else {
								// If it DOES have dependencies, then we want to wait for everything without dependencies to have been deployed first
								promiseFuncsWithDependencies.push(promiseFunc);
							}
						}
					});

					// Delete remaining resources
					_.each(remaining, (resource) => {
						// TODO: we have encountered a lot of issues with deleting Job type resources, so we will skip trying to delete them
						if (resource.kind !== "Job") {
							this.emit("info", "Delete " + resource.metadata.name);
							if (!this.options.dryRun) {
								kubePromises.push(this.kubectl.deleteByName(resource.kind, resource.metadata.name)
									.then((msg) => {
										this.emit("info", msg);
									})
									.catch((err) => {
										this.emit("error", "Error running kubectl.deleteByName('" + resource.kind + "', '" + resource.metadata.name + "')' " + err);
									}));
							}
						}
					});

					return Promise
						.all(kubePromises)
						.then(() => {
							// After all manifests without dependencies have been successfully deployed, start with the
							// manifests that have dependencies
							var promisesWithDependencies = [];
							_.each(promiseFuncsWithDependencies, (promiseFunc) => {
								promisesWithDependencies.push(promiseFunc());
							});
							return Promise.all(promisesWithDependencies);
						});
				})
				.then(() => {
					// Can only consider cluster deployment status completed if available checking is enabled,
					// otherwise it would be inaccurate
					if (this.options.available.enabled) {
						return Promise
							.all(availablePromises)
							.then(() => {
								this.emit("status", {
									name: this.options.cluster.metadata.name,
									kind: "Cluster",
									phase: "COMPLETED",
									status: "SUCCESS",
									manifest: this.options.cluster
								});
							});
					}
				})
				.then(resolve)
				.catch((err) => {
					this.emit("error", err);
					this.emit("status", {
						name: this.options.cluster.metadata.name,
						kind: "Cluster",
						phase: "COMPLETED",
						status: "FAILURE",
						manifest: this.options.cluster
					});
					reject(err);
				});
		});
	}
}

module.exports = Manifests;
