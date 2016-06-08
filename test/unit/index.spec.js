var expect = require("chai").expect;

describe("KitImageDeployer", function() {
	describe("when required", function() {
		var KitDeployer;
		beforeEach(function() {
			KitDeployer = require("../../src/index");
		});
		it("should have Deployer class", function() {
			expect(KitDeployer.Deployer).to.be.equal(require("../../src/lib/deployer"));
		});
	});
});
