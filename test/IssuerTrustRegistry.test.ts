import {expect} from "chai";
import {network} from "hardhat";

describe("IssuerTrustRegistry" , function(){
    it("creates a new issuer assessment with pending status" , async function(){
        const {ethers} = await network.create();

        // Account locali forniti automaticamente da Hardhat
        const [deployer, asserter, disputer] = await ethers.getSigners();

        // Mock collateral usa 6 decimali:
        const minimumBond = ethers.parseUnits("100", 6);
        const initialBalance = ethers.parseUnits("1000", 6);

        // 1. Deploy del token fittizio
        const collateral = await ethers.deployContract(
        "MockERC20"
        );

        // 2. Deploy del finto OOv3
        const mockOO = await ethers.deployContract(
        "MockOptimisticOracleV3",
        [minimumBond]
        );

         // 3. Deploy del nostro Registry
        const registry = await ethers.deployContract(
        "IssuerTrustRegistry",
        [
            await mockOO.getAddress(),
            await collateral.getAddress(),
            120,
            minimumBond
        ]
        );

        // 4. Diamo 1000 mock collateral all'asserter
        await (
        await collateral.mint(
            await asserter.getAddress(),
            initialBalance
        )
        ).wait();

        // 5. L'asserter autorizza il Registry a prendere il bond
        await (
        await collateral
            .connect(asserter)
            .approve(
            await registry.getAddress(),
            minimumBond
            )
        ).wait();

        // Dati della nostra assessment
        const claim = ethers.toUtf8Bytes(
        "Issuer is authorized to issue UniversityDegreeCredential"
        );

        const issuerDidHash = ethers.id(
        "did:example:unipi"
        );

        const credentialTypeHash = ethers.id(
        "UniversityDegreeCredential"
        );

        const policyHash = ethers.id(
        "MUR-2026"
        );

        const evidenceHash = ethers.id(
        "example-evidence"
        );

        const validityDuration = 3600n;

        // 6. Creiamo realmente l'assessment
        await (
        await registry
            .connect(asserter)
            .requestIssuerAssessment(
            claim,
            issuerDidHash,
            credentialTypeHash,
            policyHash,
            evidenceHash,
            validityDuration
            )
        ).wait();

        // 7. Ricostruiamo assessmentKey
        const assessmentKey =
        await registry.computeAssessmentKey(
            issuerDidHash,
            credentialTypeHash,
            policyHash
        );

        // 8. Troviamo l'assertionId creato
        const assertionId =
        await registry.latestAssertionId(
            assessmentKey
        );

        expect(assertionId).to.not.equal(
        ethers.ZeroHash
        );

        // 9. Recuperiamo l'Assessment
        const assessment =
        await registry.assessments(
            assertionId
        );

        // Status.Pending = 1
        expect(assessment.status).to.equal(1n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.validityDurations(assertionId)
        ).to.equal(validityDuration);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        expect(assessment.asserter).to.equal(
        await asserter.getAddress()
        );

    })

    it("settles an undisputed assessment as trusted" , async function(){
        const {ethers , networkHelpers} = await network.create();

        const [, asserter] = await ethers.getSigners();

        const minimumBond = ethers.parseUnits("100", 6);
        const initialBalance = ethers.parseUnits("1000", 6);

        // Deploy MockERC20
        const collateral = await ethers.deployContract(
            "MockERC20"
        );

        // Deploy Mock OOv3
        const mockOO = await ethers.deployContract(
            "MockOptimisticOracleV3",
            [minimumBond]
        );

        // Deploy Registry
        const registry = await ethers.deployContract(
            "IssuerTrustRegistry",
            [
            await mockOO.getAddress(),
            await collateral.getAddress(),
            120,
            minimumBond
            ]
        );

        // Diamo 1000 mock collateral all'asserter
        await (
            await collateral.mint(
            await asserter.getAddress(),
            initialBalance
            )
        ).wait();

        // L'asserter autorizza il Registry
        await (
            await collateral
            .connect(asserter)
            .approve(
                await registry.getAddress(),
                minimumBond
            )
        ).wait();

        const claim = ethers.toUtf8Bytes(
            "Issuer is authorized to issue UniversityDegreeCredential"
        );

        const issuerDidHash =
            ethers.id("did:example:unipi");

        const credentialTypeHash =
            ethers.id("UniversityDegreeCredential");

        const policyHash =
            ethers.id("MUR-2026");

        const evidenceHash =
            ethers.id("example-evidence");

        const validityDuration = 3600n;

        // Creazione assertion
        const assertionTx =
            await registry
            .connect(asserter)
            .requestIssuerAssessment(
                claim,
                issuerDidHash,
                credentialTypeHash,
                policyHash,
                evidenceHash,
                validityDuration
            );
        
        const assertionReceipt = await assertionTx.wait();

        if(assertionReceipt == null){
            throw new Error("assertion receipt not found");
        }

        console.log("undisputed assertion gas used: " , assertionReceipt.gasUsed.toString());

        console.log("undisputed assertion fee: " , ethers.formatEther(assertionReceipt.fee) , "ETH");

        const assessmentKey =
            await registry.computeAssessmentKey(
            issuerDidHash,
            credentialTypeHash,
            policyHash
            );

        const assertionId =
            await registry.latestAssertionId(
            assessmentKey
            );

        // Prima del settlement deve essere Pending
        let assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(1n);

        expect(assessment.validUntil).to.equal(0n);

        const mockAssertion = await mockOO.Assertions(assertionId);

        await networkHelpers.time.increaseTo(mockAssertion.expirationTime + 1n);

        // Settlement
        const settleTx = await registry.settleAssessment(assertionId);

        const settleReceipt = await settleTx.wait();

        if(settleReceipt == null){
            throw new Error("settlement receipt not found");
        }

        const settlementBlock =
            await ethers.provider.getBlock(
                settleReceipt.blockNumber
            );

        if (settlementBlock == null) {
            throw new Error("settlement block not found");
        }

        console.log("undisputed settlement gas used: " , settleReceipt.gasUsed.toString());

        console.log("undisputed settlement fee: " , ethers.formatEther(settleReceipt.fee) , "ETH");

        // Rileggiamo l'assessment
        assessment =
            await registry.assessments(assertionId);

        // Status.Trusted = 3
        expect(assessment.status).to.equal(3n);

        expect(assessment.validUntil).to.equal(
            BigInt(settlementBlock.timestamp) +
            validityDuration
        );

        // Il bond deve essere tornato all'asserter
        const finalBalance =
            await collateral.balanceOf(
            await asserter.getAddress()
            );

        expect(finalBalance).to.equal(initialBalance);

        // Anche la nostra funzione di validità deve dire true
        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(true);

        await networkHelpers.time.increaseTo(
            assessment.validUntil + 1n
        );

        assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(3n);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

    });

    it("settles a disputed assessment as Trusted when the asserter wins", async function () {

        const { ethers } = await network.create();

        const [deployer, asserter, disputer] =
            await ethers.getSigners();

        const minimumBond =
            ethers.parseUnits("100", 6);

        const initialBalance =
            ethers.parseUnits("1000", 6);

        // Deploy token
        const collateral =
            await ethers.deployContract("MockERC20");

        // Deploy mock OOv3
        const mockOO =
            await ethers.deployContract(
            "MockOptimisticOracleV3",
            [minimumBond]
            );

        // Deploy Registry
        const registry =
            await ethers.deployContract(
            "IssuerTrustRegistry",
            [
                await mockOO.getAddress(),
                await collateral.getAddress(),
                120,
                minimumBond
            ]
            );

        // Diamo token sia all'asserter sia al disputer
        await (
            await collateral.mint(
            await asserter.getAddress(),
            initialBalance
            )
        ).wait();

        await (
            await collateral.mint(
            await disputer.getAddress(),
            initialBalance
            )
        ).wait();

        // Asserter autorizza il Registry
        await (
            await collateral
            .connect(asserter)
            .approve(
                await registry.getAddress(),
                minimumBond
            )
        ).wait();

        // Dati assessment
        const claim = ethers.toUtf8Bytes(
            "Issuer is authorized to issue UniversityDegreeCredential"
        );

        const issuerDidHash =
            ethers.id("did:example:unipi");

        const credentialTypeHash =
            ethers.id("UniversityDegreeCredential");

        const policyHash =
            ethers.id("MUR-2026");

        const evidenceHash =
            ethers.id("example-evidence");

        const validityDuration = 3600n;

        // 1. Creazione assertion
        const assertionTx =
            await registry
            .connect(asserter)
            .requestIssuerAssessment(
                claim,
                issuerDidHash,
                credentialTypeHash,
                policyHash,
                evidenceHash,
                validityDuration
            );

        const assertionReceipt = await assertionTx.wait();

        if(assertionReceipt == null){
            throw new Error("assertion receipt not found");
        }

        console.log("assertion gas used: " , assertionReceipt.gasUsed.toString());

        console.log("assertion fee: " , ethers.formatEther(assertionReceipt.fee) , " ETH");

        const assessmentKey =
            await registry.computeAssessmentKey(
            issuerDidHash,
            credentialTypeHash,
            policyHash
            );

        const assertionId =
            await registry.latestAssertionId(
            assessmentKey
            );

        // Deve essere Pending
        let assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(1n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.validityDurations(assertionId)
        ).to.equal(validityDuration);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        // 2. Il disputer autorizza direttamente MockOOv3
        await (
            await collateral
            .connect(disputer)
            .approve(
                await mockOO.getAddress(),
                minimumBond
            )
        ).wait();

        const beforeDispute =
        await mockOO.Assertions(assertionId);

        console.log(
        "disputer before dispute:",
        beforeDispute.disputer
        );

        // 3. Il disputer contesta l'assertion
        const disputeTx =
            await mockOO
            .connect(disputer)
            .disputeAssertion(
                assertionId,
                await disputer.getAddress()
            );
        
        const disputeReceipt = await disputeTx.wait();

        if(disputeReceipt == null){
            throw new Error("dispute receipt not found");
        }
        
        console.log("dispute gas used: " , disputeReceipt.gasUsed.toString());

        console.log("dispute fee: " , ethers.formatEther(disputeReceipt.fee) , "ETH");

        // La callback deve aver aggiornato il Registry
        assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(2n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        // 4. Il "DVM finto" decide che l'assertion era vera
        await (
            await mockOO
            .connect(deployer)
            .setResolution(
                assertionId,
                true
            )
        ).wait();

        // 5. Settlement
        const settleTx = await registry.settleAssessment(assertionId);

        const settleReceipt = await settleTx.wait();

        if(settleReceipt == null){
            throw new Error("settle receipt not found");
        }
        
        console.log("settlement gas used: " , settleReceipt.gasUsed.toString());

        console.log("settlement fee: " , ethers.formatEther(settleReceipt.fee) , "ETH");

        // Deve essere Trusted
        assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(3n);

        expect(assessment.validUntil).to.be.greaterThan(0n);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(true);

        // Controlliamo i saldi
        const asserterFinalBalance =
            await collateral.balanceOf(
            await asserter.getAddress()
            );

        const disputerFinalBalance =
            await collateral.balanceOf(
            await disputer.getAddress()
            );

        expect(asserterFinalBalance).to.equal(
            initialBalance + minimumBond
        );

        expect(disputerFinalBalance).to.equal(
            initialBalance - minimumBond
        );
    });

    it("settles a disputed assessment as Rejected when the disputer wins", async function () {

        const { ethers } = await network.create();

        const [deployer, asserter, disputer] =
            await ethers.getSigners();

        const minimumBond =
            ethers.parseUnits("100", 6);

        const initialBalance =
            ethers.parseUnits("1000", 6);

        // Deploy token
        const collateral =
            await ethers.deployContract("MockERC20");

        // Deploy Mock OOv3
        const mockOO =
            await ethers.deployContract(
            "MockOptimisticOracleV3",
            [minimumBond]
            );

        // Deploy Registry
        const registry =
            await ethers.deployContract(
            "IssuerTrustRegistry",
            [
                await mockOO.getAddress(),
                await collateral.getAddress(),
                120,
                minimumBond
            ]
            );

        // Token all'asserter
        await (
            await collateral.mint(
            await asserter.getAddress(),
            initialBalance
            )
        ).wait();

        // Token al disputer
        await (
            await collateral.mint(
            await disputer.getAddress(),
            initialBalance
            )
        ).wait();

        // L'asserter autorizza il Registry a prendere il bond
        await (
            await collateral
            .connect(asserter)
            .approve(
                await registry.getAddress(),
                minimumBond
            )
        ).wait();

        const claim = ethers.toUtf8Bytes(
            "Issuer is authorized to issue UniversityDegreeCredential"
        );

        const issuerDidHash =
            ethers.id("did:example:unipi");

        const credentialTypeHash =
            ethers.id("UniversityDegreeCredential");

        const policyHash =
            ethers.id("MUR-2026");

        const evidenceHash =
            ethers.id("example-evidence");

        const validityDuration = 3600n;

        // 1. Creazione assessment
        await (
            await registry
            .connect(asserter)
            .requestIssuerAssessment(
                claim,
                issuerDidHash,
                credentialTypeHash,
                policyHash,
                evidenceHash,
                validityDuration
            )
        ).wait();

        const assessmentKey =
            await registry.computeAssessmentKey(
            issuerDidHash,
            credentialTypeHash,
            policyHash
            );

        const assertionId =
            await registry.latestAssertionId(
            assessmentKey
            );

        // Deve iniziare Pending
        
        let assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(1n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.validityDurations(assertionId)
        ).to.equal(validityDuration);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        // 2. Il disputer autorizza MockOOv3 a prendere il bond
        await (
            await collateral
                .connect(disputer)
                .approve(
                    await mockOO.getAddress(),
                    minimumBond
                )
        ).wait();

        // 3. Il disputer contesta l'assertion
        const disputeTx =
            await mockOO
                .connect(disputer)
                .disputeAssertion(
                    assertionId,
                    await disputer.getAddress()
                );

        const disputeReceipt =
            await disputeTx.wait();

        if(disputeReceipt == null){
            throw new Error("dispute receipt not found");
        }

        console.log(
            "dispute gas used: ",
            disputeReceipt.gasUsed.toString()
        );

        console.log(
            "dispute fee: ",
            ethers.formatEther(disputeReceipt.fee),
            "ETH"
        );

        // La callback deve aver portato lo stato a Disputed
        assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(2n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        // 4. Il DVM finto decide che l'assertion era falsa
        await (
            await mockOO
                .connect(deployer)
                .setResolution(
                    assertionId,
                    false
                )
        ).wait();

        // 5. Settlement
        const settleTx =
            await registry.settleAssessment(assertionId);

        const settleReceipt =
            await settleTx.wait();

        if(settleReceipt == null){
            throw new Error("settle receipt not found");
        }

        console.log(
            "settlement gas used: ",
            settleReceipt.gasUsed.toString()
        );

        console.log(
            "settlement fee: ",
            ethers.formatEther(settleReceipt.fee),
            "ETH"
        );

        // Deve essere Rejected
        assessment =
            await registry.assessments(assertionId);

        expect(assessment.status).to.equal(4n);

        expect(assessment.validUntil).to.equal(0n);

        expect(
            await registry.isAssessmentValid(assertionId)
        ).to.equal(false);

        // Il disputer vince entrambi i bond
        const asserterFinalBalance =
            await collateral.balanceOf(
                await asserter.getAddress()
            );

        const disputerFinalBalance =
            await collateral.balanceOf(
                await disputer.getAddress()
            );

        expect(asserterFinalBalance).to.equal(
            initialBalance - minimumBond
        );

        expect(disputerFinalBalance).to.equal(
            initialBalance + minimumBond
        );

    
    });
    
});
