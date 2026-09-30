// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Mock{
    function transferFrom(address from , address to , uint256 amount)external returns (bool);
    function transfer(address to , uint256 amount)external returns (bool);
}

interface IAssertionCallback{
    function assertionDisputedCallback(bytes32 assertionId)external;
    function assertionResolvedCallback(bytes32 assertionId , bool assertedTruthfully)external;
}

contract MockOptimisticOracleV3{
    address public owner;
    uint256 public minimumBond;
    uint256 private nonce;

    struct MockAssertion{
        address asserter;
        address callBackRecipient;
        address currency;
        uint256 bond;
        uint64 expirationTime;
        address disputer;
        bool settled;
        bool resolutionSet;
        bool resolution;
    }

    mapping(bytes32 => MockAssertion) public Assertions;

    constructor(uint256 minimum_Bond){
        owner = msg.sender;
        minimumBond = minimum_Bond;
    }

    function getMinimumBond(address)external view returns (uint256){
        return minimumBond;
    }

    function assertTruth(
        bytes memory claim,
        address asserter,
        address callBackRecipient,
        address,
        uint64 liveness,
        IERC20Mock currency,
        uint256 bond,
        bytes32,
        bytes32
    )external returns (bytes32 assertionId){

        require(bond >= minimumBond , "Bond too low");
        require(currency.transferFrom(msg.sender , address(this) , bond) , "bond transfer failed");

        assertionId = keccak256(
            abi.encode(
                msg.sender,
                claim,
                block.timestamp,
                nonce
            )
        );

        nonce++;

        Assertions[assertionId] = MockAssertion({
            asserter : asserter,
            callBackRecipient : callBackRecipient,
            currency : address(currency),
            bond : bond,
            expirationTime : uint64(block.timestamp) + liveness,
            disputer : address(0),
            settled : false,
            resolutionSet : false,
            resolution : false
        });

    }

    function disputeAssertion(bytes32 assertionId , address disputer)external{

        require(disputer != address(0) , "disputer cannot be zero");

        MockAssertion storage assertion = Assertions[assertionId];

        require(assertion.asserter != address(0) , "assertion does not exist");
        require(assertion.disputer == address(0) , "assertion already disputed");
        require(block.timestamp < assertion.expirationTime , "assertion expired");

        assertion.disputer = disputer;

        require(
            IERC20Mock(assertion.currency).transferFrom(
                msg.sender,
                address(this),
                assertion.bond
            ),
            "disputer bond transfer failed"
        );

        if(assertion.callBackRecipient != address(0)){
            IAssertionCallback(assertion.callBackRecipient).assertionDisputedCallback(assertionId);
        }

    }

    function setResolution(bytes32 assertionId , bool resolution)external{

        require(msg.sender == owner , "only owner can set the resolution");

        MockAssertion storage assertion = Assertions[assertionId];

        require(assertion.asserter != address(0) , "assertion does not exists");
        require(assertion.disputer != address(0) , "assertion was not disputed");
        require(!assertion.settled , "assertion already settled");

        assertion.resolution = resolution;
        assertion.resolutionSet = true;

    }

    function settleAssertion(bytes32 assertionId)external{

        MockAssertion storage assertion = Assertions[assertionId];

        require(assertion.asserter != address(0) , "assertion does not exists");
        require(!assertion.settled , "assertion already settled");

        bool assertedTruthfully;

        if(assertion.disputer == address(0)){

            require(block.timestamp >= assertion.expirationTime , "assertion expired");

            assertedTruthfully = true;
            assertion.settled = true;

            require(
                IERC20Mock(assertion.currency).transfer(
                    assertion.asserter,
                    assertion.bond
                ),
                "asserter bond return failed"
            );
        }
        else{
            require(assertion.resolutionSet , "resolution not set");
            assertedTruthfully = assertion.resolution;

            address winner;
            if(assertedTruthfully){
                winner = assertion.asserter;
            }
            else{
                winner = assertion.disputer;
            }

            assertion.settled = true;

            require(
                IERC20Mock(assertion.currency).transfer(
                    winner,
                    assertion.bond * 2
                ),
                "winner payout failed"
            );


        }

        if(assertion.callBackRecipient != address(0)){
            IAssertionCallback(assertion.callBackRecipient).assertionResolvedCallback(assertionId , assertedTruthfully);
        }
    }
}