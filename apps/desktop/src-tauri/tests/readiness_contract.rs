use serde_json::json;
use voxstudio_desktop_lib::readiness::{
    derive_can_create, ReadinessRequirement, ReadinessRequirementId, ReadinessSnapshot,
    ReadinessState,
};
use voxstudio_desktop_lib::{derive_readiness_snapshot, get_readiness_snapshot};

fn requirement(
    id: ReadinessRequirementId,
    required: bool,
    state: ReadinessState,
) -> ReadinessRequirement {
    ReadinessRequirement {
        id,
        required,
        state,
    }
}

#[test]
fn requirement_ids_have_exact_camel_case_wire_values() {
    let ids = [
        ReadinessRequirementId::Conversation,
        ReadinessRequirementId::VoicePresence,
        ReadinessRequirementId::Knowledge,
    ];

    for id in &ids {
        match id {
            ReadinessRequirementId::Conversation
            | ReadinessRequirementId::VoicePresence
            | ReadinessRequirementId::Knowledge => {}
        }
    }

    assert_eq!(
        serde_json::to_value(ids).expect("requirement IDs should serialize"),
        json!(["conversation", "voicePresence", "knowledge"])
    );
}

#[test]
fn readiness_states_have_exact_camel_case_wire_values() {
    let states = [
        ReadinessState::NotStarted,
        ReadinessState::Checking,
        ReadinessState::Passed,
        ReadinessState::NeedsAction,
    ];

    for state in &states {
        match state {
            ReadinessState::NotStarted
            | ReadinessState::Checking
            | ReadinessState::Passed
            | ReadinessState::NeedsAction => {}
        }
    }

    assert_eq!(
        serde_json::to_value(states).expect("readiness states should serialize"),
        json!(["notStarted", "checking", "passed", "needsAction"])
    );
}

#[test]
fn snapshot_wire_json_marks_all_authoritative_requirements_required() {
    let snapshot = ReadinessSnapshot {
        requirements: vec![
            requirement(
                ReadinessRequirementId::Conversation,
                true,
                ReadinessState::NotStarted,
            ),
            requirement(
                ReadinessRequirementId::VoicePresence,
                true,
                ReadinessState::Checking,
            ),
            requirement(
                ReadinessRequirementId::Knowledge,
                true,
                ReadinessState::NeedsAction,
            ),
        ],
        can_create: false,
    };

    assert_eq!(
        serde_json::to_value(snapshot).expect("snapshot should serialize"),
        json!({
            "requirements": [
                { "id": "conversation", "required": true, "state": "notStarted" },
                { "id": "voicePresence", "required": true, "state": "checking" },
                { "id": "knowledge", "required": true, "state": "needsAction" }
            ],
            "canCreate": false
        })
    );
}

#[test]
fn zero_requirements_cannot_create() {
    assert!(!derive_can_create(&[]));
}

#[test]
fn any_required_non_passed_state_cannot_create() {
    for state in [
        ReadinessState::NotStarted,
        ReadinessState::Checking,
        ReadinessState::NeedsAction,
    ] {
        let requirements = [requirement(
            ReadinessRequirementId::Conversation,
            true,
            state,
        )];

        assert!(!derive_can_create(&requirements));
    }
}

#[test]
fn every_required_passed_state_can_create() {
    let requirements = [
        requirement(
            ReadinessRequirementId::Conversation,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::VoicePresence,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
    ];

    assert!(derive_can_create(&requirements));
}

#[test]
fn derivation_command_accepts_the_exact_complete_passed_set() {
    let requirements = vec![
        requirement(
            ReadinessRequirementId::Conversation,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::VoicePresence,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
    ];

    assert_eq!(
        derive_readiness_snapshot(requirements.clone()),
        ReadinessSnapshot {
            requirements,
            can_create: true,
        }
    );
}

#[test]
fn fail_closed_when_authoritative_requirement_is_missing() {
    let requirements = [
        requirement(
            ReadinessRequirementId::Conversation,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
    ];

    assert!(!derive_can_create(&requirements));
}

#[test]
fn fail_closed_when_authoritative_requirement_is_marked_optional() {
    let requirements = [
        requirement(
            ReadinessRequirementId::Conversation,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::VoicePresence,
            false,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
    ];

    assert!(!derive_can_create(&requirements));
}

#[test]
fn fail_closed_when_authoritative_requirement_is_duplicated() {
    let requirements = [
        requirement(
            ReadinessRequirementId::Conversation,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::VoicePresence,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
        requirement(
            ReadinessRequirementId::Knowledge,
            true,
            ReadinessState::Passed,
        ),
    ];

    assert!(!derive_can_create(&requirements));
}

#[test]
fn baseline_snapshot_starts_every_required_outcome_not_started() {
    assert_eq!(
        serde_json::to_value(get_readiness_snapshot()).expect("baseline snapshot should serialize"),
        json!({
            "requirements": [
                { "id": "conversation", "required": true, "state": "notStarted" },
                { "id": "voicePresence", "required": true, "state": "notStarted" },
                { "id": "knowledge", "required": true, "state": "notStarted" }
            ],
            "canCreate": false
        })
    );
}

#[test]
fn requirements_deserialize_from_exact_camel_case_wire_values() {
    let requirements: Vec<ReadinessRequirement> = serde_json::from_value(json!([
        { "id": "conversation", "required": true, "state": "notStarted" },
        { "id": "voicePresence", "required": true, "state": "checking" },
        { "id": "knowledge", "required": true, "state": "needsAction" }
    ]))
    .expect("valid client requirements should deserialize");

    assert_eq!(
        requirements,
        vec![
            requirement(
                ReadinessRequirementId::Conversation,
                true,
                ReadinessState::NotStarted,
            ),
            requirement(
                ReadinessRequirementId::VoicePresence,
                true,
                ReadinessState::Checking,
            ),
            requirement(
                ReadinessRequirementId::Knowledge,
                true,
                ReadinessState::NeedsAction,
            ),
        ]
    );
}

#[test]
fn malformed_client_requirements_are_rejected() {
    for malformed in [
        json!({ "id": "voice_presence", "required": true, "state": "passed" }),
        json!({ "id": "conversation", "required": true, "state": "ready" }),
        json!({ "id": "conversation", "state": "passed" }),
        json!({
            "id": "conversation",
            "required": true,
            "state": "passed",
            "canCreate": true
        }),
    ] {
        assert!(serde_json::from_value::<ReadinessRequirement>(malformed).is_err());
    }
}
