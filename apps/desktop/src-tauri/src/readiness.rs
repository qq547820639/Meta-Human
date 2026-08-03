use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadinessRequirementId {
    Conversation,
    VoicePresence,
    Knowledge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadinessState {
    NotStarted,
    Checking,
    Passed,
    NeedsAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadinessRequirement {
    pub id: ReadinessRequirementId,
    pub required: bool,
    pub state: ReadinessState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessSnapshot {
    pub requirements: Vec<ReadinessRequirement>,
    pub can_create: bool,
}

pub fn derive_can_create(requirements: &[ReadinessRequirement]) -> bool {
    let authoritative_ids = [
        ReadinessRequirementId::Conversation,
        ReadinessRequirementId::VoicePresence,
        ReadinessRequirementId::Knowledge,
    ];

    requirements.len() == authoritative_ids.len()
        && authoritative_ids.iter().all(|id| {
            requirements.iter().any(|requirement| {
                requirement.id == *id
                    && requirement.required
                    && requirement.state == ReadinessState::Passed
            })
        })
}

pub fn baseline_snapshot() -> ReadinessSnapshot {
    let requirements = vec![
        ReadinessRequirement {
            id: ReadinessRequirementId::Conversation,
            required: true,
            state: ReadinessState::NotStarted,
        },
        ReadinessRequirement {
            id: ReadinessRequirementId::VoicePresence,
            required: true,
            state: ReadinessState::NotStarted,
        },
        ReadinessRequirement {
            id: ReadinessRequirementId::Knowledge,
            required: true,
            state: ReadinessState::NotStarted,
        },
    ];
    let can_create = derive_can_create(&requirements);

    ReadinessSnapshot {
        requirements,
        can_create,
    }
}

#[tauri::command]
pub fn get_readiness_snapshot() -> ReadinessSnapshot {
    baseline_snapshot()
}

#[tauri::command]
pub fn derive_readiness_snapshot(requirements: Vec<ReadinessRequirement>) -> ReadinessSnapshot {
    let can_create = derive_can_create(&requirements);
    ReadinessSnapshot {
        requirements,
        can_create,
    }
}
