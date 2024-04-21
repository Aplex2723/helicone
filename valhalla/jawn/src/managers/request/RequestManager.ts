// src/users/usersService.ts
import { RequestQueryParams } from "../../controllers/public/requestController";
import { FREQUENT_PRECENT_LOGGING } from "../../lib/db/DBQueryTimer";
import { supabaseServer } from "../../lib/db/supabase";
import { Result, err, ok } from "../../lib/modules/result";
import {
  HeliconeRequest,
  getRequests,
  getRequestsCached,
} from "../../lib/stores/request/request";
import { BaseManager } from "../BaseManager";

export class RequestManager extends BaseManager {
  private async waitForRequestAndResponse(
    heliconeId: string,
    organizationId: string
  ): Promise<
    Result<
      {
        requestId: string;
        responseId: string;
      },
      string
    >
  > {
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
      const { data: request, error: requestError } =
        await this.queryTimer.withTiming(
          supabaseServer.client
            .from("request")
            .select("*")
            .eq("id", heliconeId)
            .eq("helicone_org_id", organizationId),
          {
            queryName: "select_request_by_id",
            percentLogging: FREQUENT_PRECENT_LOGGING,
          }
        );

      if (requestError) {
        console.error("Error fetching request:", requestError.message);
        return err(requestError.message);
      }

      const { data: response, error: responseError } =
        await this.queryTimer.withTiming(
          supabaseServer.client
            .from("response")
            .select("*")
            .eq("request", heliconeId),
          {
            queryName: "select_response_by_request",
            percentLogging: FREQUENT_PRECENT_LOGGING,
          }
        );

      if (responseError) {
        console.error("Error fetching response:", responseError.message);
        return err(responseError.message);
      }

      if (request && request.length > 0) {
        return ok({ requestId: request[0].id, responseId: response[0].id });
      }

      const sleepDuration = i === 0 ? 1000 : 5000;
      await new Promise((resolve) => setTimeout(resolve, sleepDuration));
    }

    return { error: "Request not found.", data: null };
  }
  async feedbackRequest(
    requestId: string,
    feedback: boolean
  ): Promise<Result<null, string>> {
    const requestResponse = await this.waitForRequestAndResponse(
      requestId,
      this.authParams.organizationId
    );

    if (requestResponse.error || !requestResponse.data) {
      return err("Request not found");
    }

    const feedbackResult = await this.queryTimer.withTiming(
      supabaseServer.client
        .from("feedback")
        .upsert(
          {
            response_id: requestResponse.data.responseId,
            rating: feedback,
            created_at: new Date().toISOString(),
          },
          { onConflict: "response_id" }
        )
        .select("*")
        .single(),
      {
        queryName: "upsert_feedback_by_response_id",
        percentLogging: FREQUENT_PRECENT_LOGGING,
      }
    );

    if (feedbackResult.error) {
      console.error("Error upserting feedback:", feedbackResult.error);
      return err(feedbackResult.error.message);
    }

    return ok(null);
  }

  async getRequests(
    params: RequestQueryParams
  ): Promise<Result<HeliconeRequest[], string>> {
    const {
      filter,
      offset = 0,
      limit = 10,
      sort = {
        created_at: "desc",
      },
      isCached,
    } = params;

    return isCached
      ? await getRequestsCached(
          this.authParams.organizationId,
          filter,
          offset,
          limit,
          sort
        )
      : await getRequests(
          this.authParams.organizationId,
          filter,
          offset,
          limit,
          sort
        );
  }
}
