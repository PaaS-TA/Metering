package org.openpaas.servicebroker.model.fixture;

import org.json.JSONArray;
import org.json.JSONObject;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;

public class UsageReportFixture {
	
	private static final String RESOURCE_ID = "linux-container";
	
	private static final int BIND = 1;
	private static final int UNBIND = 0;

	private static final String MEASURE_1 = "sample_service_usage_param1";
	private static final String MEASURE_2 = "sample_service_usage_param2";
	private static final String MEASURE_3 = "previous_sample_service_usage_param1";
	private static final String MEASURE_4 = "previous_sample_service_usage_param2";

	private static final String STANDARD_PLAN_ID = "standard";

	private static final int PLAN_STANDARD_QUANTITY = 50000000;
	private static final int PLAN_EXTRA_QUANTITY = 1000000000;
	
	private static final long FIXED_TIMESTAMP = 1476835652;

	public static JSONObject getUsageReportOnCreateBind() {
		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();
		return buildServiceUsage(
				binding.getAppOrganizationId(),
				binding.getAppSpaceId(),
				binding.getAppGuid(),
				binding.getMeteringPlanId(),
				BIND
				);		
	}	
	
	public static JSONObject getUsageReportOnDeleteBind() {
		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();
		return buildServiceUsage(
				binding.getAppOrganizationId(),
				binding.getAppSpaceId(),
				binding.getAppGuid(),
				binding.getMeteringPlanId(),
				UNBIND
				);		
	}	

	private static JSONObject buildServiceUsage(String orgId, String spaceId, String appId, String planId, int mode) {

		JSONObject jsonObjectUsage = new JSONObject();

		jsonObjectUsage.put("start", FIXED_TIMESTAMP);
		jsonObjectUsage.put("end", FIXED_TIMESTAMP);
		jsonObjectUsage.put("organization_id", orgId);
		jsonObjectUsage.put("space_id", spaceId);
		jsonObjectUsage.put("consumer_id", "app:" + appId);
		jsonObjectUsage.put("resource_id", RESOURCE_ID);
		jsonObjectUsage.put("plan_id", planId);
		jsonObjectUsage.put("resource_instance_id", appId);

		JSONArray measuredUsageArr = new JSONArray();
		JSONObject measuredUsage1 = new JSONObject();
		JSONObject measuredUsage2 = new JSONObject();
		JSONObject measuredUsage3 = new JSONObject();
		JSONObject measuredUsage4 = new JSONObject();

		int quantity = 0;

		if (STANDARD_PLAN_ID.equals(planId)) {
			quantity = PLAN_STANDARD_QUANTITY;
		} else {
			quantity = PLAN_EXTRA_QUANTITY;
		}

		if (mode == BIND) {

			measuredUsage1.put("measure", MEASURE_1);
			measuredUsage1.put("quantity", quantity);
			measuredUsageArr.put(measuredUsage1);
			measuredUsage2.put("measure", MEASURE_2);
			measuredUsage2.put("quantity", 1);
			measuredUsageArr.put(measuredUsage2);
			measuredUsage3.put("measure", MEASURE_3);
			measuredUsage3.put("quantity", 0);
			measuredUsageArr.put(measuredUsage3);
			measuredUsage4.put("measure", MEASURE_4);
			measuredUsage4.put("quantity", 0);
			measuredUsageArr.put(measuredUsage4);

		} else { // UNBIND

			measuredUsage1.put("measure", MEASURE_1);
			measuredUsage1.put("quantity", 0);
			measuredUsageArr.put(measuredUsage1);
			measuredUsage2.put("measure", MEASURE_2);
			measuredUsage2.put("quantity", 0);
			measuredUsageArr.put(measuredUsage2);
			measuredUsage3.put("measure", MEASURE_3);
			measuredUsage3.put("quantity", quantity);
			measuredUsageArr.put(measuredUsage3);
			measuredUsage4.put("measure", MEASURE_4);
			measuredUsage4.put("quantity", 1);
			measuredUsageArr.put(measuredUsage4);
		}

		jsonObjectUsage.put("measured_usage", measuredUsageArr);
		return jsonObjectUsage;
	}
}
