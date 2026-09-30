// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@uma/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol";
import "@uma/core/contracts/optimistic-oracle-v3/interfaces/OptimisticOracleV3CallbackRecipientInterface.sol";

//import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract IssuerTrustRegistry is OptimisticOracleV3CallbackRecipientInterface{

    //collegamento UMA
    OptimisticOracleV3Interface public oo;

    //configurazione dell'assertion
    IERC20 public collateral;
    uint64 public assertionLiveness;
    uint256 public bond;
    bytes32 public constant ASSERT_TRUTH2 = "ASSERT_TRUTH2";

    //costruttore
    constructor(address _optimisticOracleV3 , address _collateral , uint64 _assertionLiveness , uint256 _bond) {
        oo = OptimisticOracleV3Interface(_optimisticOracleV3);
        collateral = IERC20(_collateral);
        assertionLiveness = _assertionLiveness;
        bond = _bond;
    }


    //stato di valutazione
    enum Status{
        None,
        Pending,
        Disputed,
        Trusted,
        Rejected
    }

    //struttura dell'assesment
    struct Assessment{
        bytes32 issuerDidHash;
        bytes32 credentialTypeHash;
        bytes32 policyHash;
        bytes32 evidenceHash;
        uint64 validUntil;
        Status status;
        address asserter;
    }

    mapping(bytes32 => Assessment) public assessments;
    mapping(bytes32 => uint64) public validityDurations;

    // assessmentKey -> ultimo assertionId
    mapping(bytes32 => bytes32) public latestAssertionId;

    event AssessmentRequested(
        bytes32 indexed assertionId,
        bytes32 indexed assessmentKey,
        address indexed asserter
    );

    event AssessmentDisputed(
        bytes32 indexed assertionId
    );

    event AssessmentResolved(
        bytes32 indexed assertionId,
        bool assertedTruthfully
    );

    function computeAssessmentKey(
        bytes32 issuerDidHash,
        bytes32 credentialTypeHash,
        bytes32 policyHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                issuerDidHash,
                credentialTypeHash,
                policyHash
            )
        );
    }

    function requestIssuerAssessment(
        bytes memory claim,
        bytes32 issuerDidHash,
        bytes32 credentialTypeHash,
        bytes32 policyHash,
        bytes32 evidenceHash,
        uint64 validityDuration
    ) external returns (bytes32 assertionId) {
        bytes32 assessmentKey = computeAssessmentKey(issuerDidHash , credentialTypeHash , policyHash);

        uint256 assertionBond = bond;
        uint256 minimumBond = oo.getMinimumBond(address(collateral));

        if (assertionBond < minimumBond) {
            assertionBond = minimumBond;
        }

        require(collateral.transferFrom(msg.sender , address(this) , assertionBond) , "bond transfer failed");

        require(collateral.approve(address(oo) , assertionBond) , "OOv3 approval failed");

        assertionId = oo.assertTruth(
            claim,
            msg.sender,
            address(this),
            address(0),
            assertionLiveness,
            collateral,
            assertionBond,
            ASSERT_TRUTH2,
            bytes32(0)
        );

        assessments[assertionId] = Assessment({
            issuerDidHash : issuerDidHash,
            credentialTypeHash : credentialTypeHash,
            policyHash : policyHash,
            evidenceHash : evidenceHash,
            validUntil : 0,
            status : Status.Pending,
            asserter : msg.sender
        });

        validityDurations[assertionId] = validityDuration;

        latestAssertionId[assessmentKey] = assertionId;

        emit AssessmentRequested(assertionId , assessmentKey , msg.sender);

    }

    function assertionDisputedCallback(bytes32 assertionId) external override{

        require(msg.sender == address(oo), "only OOv3 can call this function");
        require(assessments[assertionId].status != Status.None , "unknown assertion");

        assessments[assertionId].status = Status.Disputed;

        emit AssessmentDisputed(assertionId);
    }

    function assertionResolvedCallback(bytes32 assertionId , bool assertedThruthfully)external override{

        require(msg.sender == address(oo) , "only OOv3 can call this function");
        require(assessments[assertionId].status != Status.None , "unknown assertion");

        Assessment storage assessment = assessments[assertionId];

        if(assertedThruthfully){
            assessment.status = Status.Trusted;

            assessment.validUntil = uint64(block.timestamp) + validityDurations[assertionId];
        }
        else{
            assessment.status = Status.Rejected;

            assessment.validUntil = 0;
        }

        emit AssessmentResolved(assertionId , assertedThruthfully);
    }

    function settleAssessment(bytes32 assertionId)external{

        require(assessments[assertionId].status != Status.None , "unknown assertion");

        oo.settleAssertion(assertionId);
    }

    function getLatestAssessment(
        bytes32 issuerDidHash ,
        bytes32 credentialTypeHash ,
        bytes32 policyHash
    )external view returns(
        bytes32 assertionId,
        Assessment memory assessment
    ){
        bytes32 assessmentKey = computeAssessmentKey(issuerDidHash , credentialTypeHash , policyHash);

        assertionId = latestAssertionId[assessmentKey];

        require(assertionId != bytes32(0) , "assessment not found");

        assessment = assessments[assertionId];
    }

    function isAssessmentValid(bytes32 assertionId)external view returns(bool){

        Assessment memory assessment = assessments[assertionId];

        return(
            assessment.status == Status.Trusted && assessment.validUntil > block.timestamp
        );
    }
}