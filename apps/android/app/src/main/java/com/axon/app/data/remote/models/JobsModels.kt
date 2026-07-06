package com.axon.app.data.remote.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** POST /v1/extract request body. */
@Serializable
data class ExtractRequest(
    val urls: List<String>,
    val prompt: String? = null,
    @SerialName("max_pages") val maxPages: Int? = null,
    @SerialName("render_mode") val renderMode: String? = null,
    val embed: Boolean? = null,
    val headers: List<String> = emptyList(),
)

/** Legacy embed request body, adapted to the unified source endpoint by AxonClient. */
@Serializable
data class EmbedRequest(
    val input: String,
    val collection: String? = null,
    @SerialName("source_type") val sourceType: String? = null,
)

/** POST /v1/sources request body for the clean-break source pipeline. */
@Serializable
data class SourceRequest(
    val source: String,
    val intent: String = "acquire",
    val embed: Boolean = true,
    val limits: SourceLimits = SourceLimits(),
    val scope: String? = null,
    val collection: String? = null,
    val adapter: String? = null,
)

@Serializable
data class SourceLimits(
    @SerialName("max_depth") val maxDepth: Int? = null,
    @SerialName("max_pages") val maxPages: Int? = null,
)

@Serializable
data class SourceResult(
    @SerialName("job_id") val jobId: String,
    @SerialName("canonical_uri") val canonicalUri: String = "",
    val status: String = "",
)

@Serializable
data class UnifiedJobSummary(
    @SerialName("job_id") val jobId: String,
    val kind: String = "",
    val status: String = "",
    val phase: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class UnifiedJobListPage(
    val items: List<UnifiedJobSummary> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
    val limit: Int = 0,
    val total: Long? = null,
)

@Serializable
data class UnifiedJobCancelResult(
    @SerialName("job_id") val jobId: String = "",
    val status: String = "",
)

/** ServiceJob — common app shape adapted from the unified jobs endpoint. */
@Serializable
data class ServiceJob(
    val id: String = "",
    val status: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("finished_at") val finishedAt: String? = null,
    @SerialName("error_text") val errorText: String? = null,
    val url: String? = null,                                       // crawl
    @SerialName("source_type") val sourceType: String? = null,      // ingest
    val target: String? = null,                                     // ingest/embed/extract
    @SerialName("progress_json") val progressJson: JsonElement? = null,
    @SerialName("result_json") val resultJson: JsonElement? = null, // locked: JsonElement, not JsonObject
    @SerialName("config_json") val configJson: JsonElement? = null,
)

/** Legacy paginated job list shape retained for older tests/data. */
@Serializable
data class JobListResponse(
    val jobs: List<ServiceJob> = emptyList(),
    val limit: Int = 0,
    val offset: Int = 0,
)

/** Legacy job detail envelope retained for older tests/data. */
@Serializable
data class JobDetailResponse(
    val job: ServiceJob,
)

/** GET /v1/status response — aggregated job counts. */
@Serializable
data class StatusSummary(
    val payload: JsonElement,
)

/** Legacy cancel response adapted from the unified cancel endpoint. */
@Serializable
data class CancelResponse(
    val canceled: Boolean = false,
)

/** GET /v1/watch response envelope. */
@Serializable
data class WatchListResponse(
    val watches: List<WatchDef> = emptyList(),
)

/** Watch definition shape returned by the REST watch list endpoint. */
@Serializable
data class WatchDef(
    val id: String = "",
    val name: String = "",
    @SerialName("task_type") val taskType: String = "",
    @SerialName("task_payload") val taskPayload: JsonElement? = null,
    @SerialName("every_seconds") val everySeconds: Long = 0L,
    val enabled: Boolean = false,
    @SerialName("next_run_at") val nextRunAt: String? = null,
    @SerialName("lease_expires_at") val leaseExpiresAt: String? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)
