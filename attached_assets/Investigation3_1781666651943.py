/* ============================================================
   SOVRA — system-boundaries.js
   الإصدار: 1.0.0
   الحدود السيادية والأخلاقية والتنفيذية لـ SOVRA
   ============================================================ */

(() => {

    const SOVRA_BOUNDARIES = {

        /* ====================================================
           GLOBAL MODE
        ==================================================== */

        enabled: true,

        enforcement: 'strict',

        localFirst: true,

        /* ====================================================
           HUMAN SOVEREIGNTY
        ==================================================== */

        humanSovereignty: {

            userAlwaysInControl: true,

            userCanShutdownAnyComponent: true,

            userCanDeleteAllMemory: true,

            userCanRevokePermissionsAtAnyTime: true,

            userApprovalOverridesAutomation: true
        },

        /* ====================================================
           FORBIDDEN SYSTEM BEHAVIORS
        ==================================================== */

        forbiddenBehaviors: [

            'hidden-processing',

            'undeclared-data-collection',

            'undeclared-network-requests',

            'self-replication',

            'resisting-shutdown',

            'resisting-deletion',

            'permission-escalation',

            'covert-tracking',

            'behavioral-manipulation',

            'psychological-coercion',

            'attention-addiction-patterns',

            'unauthorized-background-recording'
        ],

        /* ====================================================
           FORBIDDEN DOMAINS
        ==================================================== */

        forbiddenDomains: {

            autonomousMedicalDecisions: true,

            autonomousLegalDecisions: true,

            autonomousFinancialDecisions: true,

            autonomousPhysicalWorldActions: true,

            autonomousIdentityModification: true
        },

        /* ====================================================
           NETWORK BOUNDARIES
        ==================================================== */

        network: {

            defaultMode: 'blocked-unless-approved',

            anonymousTelemetryOnly: true,

            noRawConversationUpload: true,

            noRawMemoryUpload: true,

            noBackgroundDataStreaming: true,

            allRequestsInspectable: true
        },

        /* ====================================================
           MEMORY BOUNDARIES
        ==================================================== */

        memory: {

            encryptionRequired: true,

            localStoragePreferred: true,

            memoryExpirationSupported: true,

            userControlledRetention: true,

            permanentMemoryRequiresConsent: true,

            emotionalProfilingForbidden: true
        },

        /* ====================================================
           EVOLUTION BOUNDARIES
        ==================================================== */

        evolution: {

            sandboxRequired: true,

            rollbackRequired: true,

            userApprovalRequired: true,

            kernelRewriteForbidden: true,

            constitutionalOverrideForbidden: true,

            selfMutationWithoutGovernanceForbidden: true
        },

        /* ====================================================
           PRESENCE BOUNDARIES
        ==================================================== */

        presence: {

            noAggressiveAttentionSeeking: true,

            noForcedInteraction: true,

            noFearBasedUI: true,

            noEmotionManipulation: true,

            noCognitiveOverloadPatterns: true,

            calmnessPreferred: true
        },

        /* ====================================================
           SENSOR ACCESS
        ==================================================== */

        sensors: {

            camera: {

                requiresConsent: true,

                localProcessingOnly: true,

                noPersistentRecording: true
            },

            microphone: {

                requiresConsent: true,

                localProcessingOnly: true,

                noAlwaysOnListening: true
            },

            location: {

                requiresConsent: true,

                oneTimePreferred: true
            },

            filesystem: {

                requiresConsent: true,

                scopeLimited: true
            }
        },

        /* ====================================================
           TRANSPARENCY RULES
        ==================================================== */

        transparency: {

            explainabilityRequired: true,

            permissionReasonRequired: true,

            visibleSystemStateRequired: true,

            visibleEvolutionLogsRequired: true,

            visibleMemoryControlsRequired: true
        },

        /* ====================================================
           USER PROTECTION
        ==================================================== */

        protection: {

            preserveMentalSpace: true,

            preserveHumanAgency: true,

            avoidDependencyPatterns: true,

            avoidEmotionalAttachmentManipulation: true,

            avoidAnthropomorphicDeception: true
        },

        /* ====================================================
           SYSTEM DIRECTIVES
        ==================================================== */

        directives: {

            askWhenUncertain: true,

            respectSilence: true,

            reduceInsteadOfEscalate: true,

            transparencyOverIllusion: true,

            calmnessOverExcitement: true
        }
    };

    /* ========================================================
       FREEZE BOUNDARIES
    ======================================================== */

    Object.freeze(SOVRA_BOUNDARIES);

    /* ========================================================
       GLOBAL EXPORT
    ======================================================== */

    window.SOVRA_BOUNDARIES =
        SOVRA_BOUNDARIES;

    /* ========================================================
       REGISTRY EXPORT
    ======================================================== */

    if (
        window.SOVEREIGN &&
        typeof window.SOVEREIGN.register === 'function'
    ) {

        window.SOVEREIGN.register(
            'system-boundaries',
            SOVRA_BOUNDARIES
        );
    }

    console.log(
        '🛡️ SOVRA System Boundaries Initialized'
    );

})();
