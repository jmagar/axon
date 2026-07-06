package com.axon.app.data.remote.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Legacy ingest request body, adapted to the unified source endpoint by AxonClient. */
@Serializable
data class IngestRequest(
    @SerialName("source_type") val sourceType: String,   // "github"|"gitlab"|"gitea"|"git"|"reddit"|"youtube"
    val target: String? = null,
    @SerialName("include_source") val includeSource: Boolean? = null,
)

/** Accepted job response used by app-level operation flows. */
@Serializable
data class AcceptedJob(
    @SerialName("job_id") val jobId: String,
    val status: String = "pending",
    @SerialName("status_url") val statusUrl: String? = null,
)
