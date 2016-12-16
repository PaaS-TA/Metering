package org.openpaas.servicebroker.mongodb.meteringTest;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Spy;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;
import org.openpaas.servicebroker.model.fixture.ServiceInstanceBindingFixture;
import org.openpaas.servicebroker.model.fixture.UsageReportFixture;
import org.openpaas.servicebroker.mongodb.service.impl.SampleMeteringOAuthServiceImpl;
import org.openpaas.servicebroker.mongodb.service.impl.SampleMeteringReportServiceImpl;
import org.powermock.api.mockito.PowerMockito;
import org.powermock.core.classloader.annotations.PowerMockIgnore;
import org.powermock.core.classloader.annotations.PrepareForTest;
import org.powermock.modules.junit4.PowerMockRunner;
import org.springframework.test.util.ReflectionTestUtils;

@PowerMockIgnore("javax.net.ssl.*")
@RunWith(PowerMockRunner.class)
@PrepareForTest({ SampleMeteringReportServiceImplUnitTest.class })
public class SampleMeteringReportServiceImplUnitTest {

	private static final int BIND = 1;
	private static final int UNBIND = 0;

	@Spy
	SampleMeteringOAuthServiceImpl sampleMeteringOAuthService = new SampleMeteringOAuthServiceImpl();

	@Spy
	SampleMeteringReportServiceImpl sampleMeteringReportService = new SampleMeteringReportServiceImpl();

	HttpsURLConnection dummyConnSecured;
	HttpURLConnection dummyConn;

	String testCollectorUrlSecured = "https://dummyCollectUrl.com";
	String testCollectorUrl = "http://dummyCollectUrl.com";

	@Before
	public void setup() throws Exception {

		try {

			URL url = PowerMockito.mock(URL.class);
			PowerMockito.whenNew(URL.class).withArguments(testCollectorUrlSecured).thenReturn(url);

			dummyConnSecured = PowerMockito.mock(HttpsURLConnection.class);
			PowerMockito.when(url.openConnection()).thenReturn(dummyConnSecured);

			OutputStream tdout = PowerMockito.mock(OutputStream.class);
			JSONObject serviceUsage = UsageReportFixture.getUsageReportOnCreateBind();
			byte[] out = serviceUsage.toString().getBytes(StandardCharsets.UTF_8);
			tdout.write(out);

			PowerMockito.when(dummyConnSecured.getOutputStream()).thenReturn(tdout);

			dummyConnSecured.setRequestMethod("POST");
			dummyConnSecured.setDoInput(true);
			dummyConnSecured.setDoOutput(true);
			dummyConnSecured.setUseCaches(false);
			dummyConnSecured.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

			InputStream anyInputStream = new ByteArrayInputStream("connection test is success".getBytes());
			PowerMockito.when(dummyConnSecured.getInputStream()).thenReturn(anyInputStream);

			// PowerMockito.when(sampleMeteringReportService.getUAAToken()).thenReturn("dummyTokenFromDummyServer");

		} catch (Exception e) {
			e.printStackTrace();
			throw e;
		}

	}

	/// 미터링 테스트 :
	@Test
	public void BindingCreateBuildAppUsageCorrectly() throws Exception {

		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();

		// 프로퍼티 파일의 값을 세팅한다.
		ReflectionTestUtils.setField(sampleMeteringReportService, "collectorUrl", "https://dummyCollectUrl.com");
		ReflectionTestUtils.setField(sampleMeteringReportService, "abacusSecured", "true");

		// Secure mode 테스트
		PowerMockito.when(sampleMeteringReportService.getConnetionHTTPS(testCollectorUrlSecured))
				.thenReturn(dummyConnSecured);

		// 기대되는 리턴 값
		JSONObject usageReport = UsageReportFixture.getUsageReportOnCreateBind();

		// 실제로 리턴 받은 값
		JSONObject actual = sampleMeteringReportService.buildServiceUsage(binding, BIND);

		// 값을 비교한다.
		assertEquals(usageReport.get("organization_id"), actual.get("organization_id"));
		assertEquals(usageReport.get("space_id"), actual.get("space_id"));
		assertEquals(usageReport.get("consumer_id"), actual.get("consumer_id"));
		assertEquals(usageReport.get("plan_id"), actual.get("plan_id"));
		assertEquals(usageReport.get("resource_instance_id"), actual.get("resource_instance_id"));

		assertNotEquals(usageReport.get("start"), actual.get("start"));
		assertNotEquals(usageReport.get("end"), actual.get("end"));

		JSONArray testdata_measured_usage_arr = (JSONArray) usageReport.get("measured_usage");
		JSONObject testdata_measured_usage_1 = (JSONObject) testdata_measured_usage_arr.get(0);
		JSONObject testdata_measured_usage_2 = (JSONObject) testdata_measured_usage_arr.get(1);
		JSONObject testdata_measured_usage_3 = (JSONObject) testdata_measured_usage_arr.get(2);
		JSONObject testdata_measured_usage_4 = (JSONObject) testdata_measured_usage_arr.get(3);

		JSONArray actual_measured_usage_arr = (JSONArray) actual.get("measured_usage");
		JSONObject actual_measured_usage_1 = (JSONObject) actual_measured_usage_arr.get(0);
		JSONObject actual_measured_usage_2 = (JSONObject) actual_measured_usage_arr.get(1);
		JSONObject actual_measured_usage_3 = (JSONObject) actual_measured_usage_arr.get(2);
		JSONObject actual_measured_usage_4 = (JSONObject) actual_measured_usage_arr.get(3);

		assertEquals(testdata_measured_usage_1.get("measure"), actual_measured_usage_1.get("measure"));
		assertEquals(testdata_measured_usage_1.get("quantity"), actual_measured_usage_1.get("quantity"));
		assertEquals(testdata_measured_usage_2.get("measure"), actual_measured_usage_2.get("measure"));
		assertEquals(testdata_measured_usage_2.get("quantity"), actual_measured_usage_2.get("quantity"));
		assertEquals(testdata_measured_usage_3.get("measure"), actual_measured_usage_3.get("measure"));
		assertEquals(testdata_measured_usage_3.get("quantity"), actual_measured_usage_3.get("quantity"));
		assertEquals(testdata_measured_usage_4.get("measure"), actual_measured_usage_4.get("measure"));
		assertEquals(testdata_measured_usage_4.get("quantity"), actual_measured_usage_4.get("quantity"));

	}

	@Test
	public void BindingDeleteBuildAppUsageCorrectly() throws Exception {

		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();

		// 프로퍼티 파일의 값을 세팅한다.
		ReflectionTestUtils.setField(sampleMeteringReportService, "collectorUrl", "https://dummyCollectUrl.com");
		ReflectionTestUtils.setField(sampleMeteringReportService, "abacusSecured", "true");

		// Secure mode 테스트
		PowerMockito.when(sampleMeteringReportService.getConnetionHTTPS(testCollectorUrlSecured))
				.thenReturn(dummyConnSecured);

		// 기대되는 리턴 값
		JSONObject usageReport = UsageReportFixture.getUsageReportOnDeleteBind();

		// 실제로 리턴 받은 값
		JSONObject actual = sampleMeteringReportService.buildServiceUsage(binding, UNBIND);

		// 값을 비교한다.
		assertEquals(usageReport.get("organization_id"), actual.get("organization_id"));
		assertEquals(usageReport.get("space_id"), actual.get("space_id"));
		assertEquals(usageReport.get("consumer_id"), actual.get("consumer_id"));
		assertEquals(usageReport.get("plan_id"), actual.get("plan_id"));
		assertEquals(usageReport.get("resource_instance_id"), actual.get("resource_instance_id"));

		assertNotEquals(usageReport.get("start"), actual.get("start"));
		assertNotEquals(usageReport.get("end"), actual.get("end"));

		JSONArray testdata_measured_usage_arr = (JSONArray) usageReport.get("measured_usage");
		JSONObject testdata_measured_usage_1 = (JSONObject) testdata_measured_usage_arr.get(0);
		JSONObject testdata_measured_usage_2 = (JSONObject) testdata_measured_usage_arr.get(1);
		JSONObject testdata_measured_usage_3 = (JSONObject) testdata_measured_usage_arr.get(2);
		JSONObject testdata_measured_usage_4 = (JSONObject) testdata_measured_usage_arr.get(3);

		JSONArray actual_measured_usage_arr = (JSONArray) actual.get("measured_usage");
		JSONObject actual_measured_usage_1 = (JSONObject) actual_measured_usage_arr.get(0);
		JSONObject actual_measured_usage_2 = (JSONObject) actual_measured_usage_arr.get(1);
		JSONObject actual_measured_usage_3 = (JSONObject) actual_measured_usage_arr.get(2);
		JSONObject actual_measured_usage_4 = (JSONObject) actual_measured_usage_arr.get(3);

		assertEquals(testdata_measured_usage_1.get("measure"), actual_measured_usage_1.get("measure"));
		assertEquals(testdata_measured_usage_1.get("quantity"), actual_measured_usage_1.get("quantity"));
		assertEquals(testdata_measured_usage_2.get("measure"), actual_measured_usage_2.get("measure"));
		assertEquals(testdata_measured_usage_2.get("quantity"), actual_measured_usage_2.get("quantity"));
		assertEquals(testdata_measured_usage_3.get("measure"), actual_measured_usage_3.get("measure"));
		assertEquals(testdata_measured_usage_3.get("quantity"), actual_measured_usage_3.get("quantity"));
		assertEquals(testdata_measured_usage_4.get("measure"), actual_measured_usage_4.get("measure"));
		assertEquals(testdata_measured_usage_4.get("quantity"), actual_measured_usage_4.get("quantity"));
	}

	/// 미터링 테스트 :
	@Test
	public void BindingCreateBuildAppUsageIncorrectly() throws Exception {

		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();

		// 프로퍼티 파일의 값을 세팅한다.
		ReflectionTestUtils.setField(sampleMeteringReportService, "collectorUrl", "https://dummyCollectUrl.com");
		ReflectionTestUtils.setField(sampleMeteringReportService, "abacusSecured", "true");

		// Secure mode 테스트
		PowerMockito.when(sampleMeteringReportService.getConnetionHTTPS(testCollectorUrlSecured))
				.thenReturn(dummyConnSecured);

		// 기대되는 리턴 값
		JSONObject usageReport = UsageReportFixture.getUsageReportOnCreateBind();

		// 잘못된 값을 입력한다.
		usageReport.put("organization_id", "");

		// 실제로 리턴 받은 값
		JSONObject actual = sampleMeteringReportService.buildServiceUsage(binding, BIND);

		// 값을 비교한다.
		assertNotEquals(usageReport.get("organization_id"), actual.get("organization_id"));
		assertEquals(usageReport.get("space_id"), actual.get("space_id"));
		assertEquals(usageReport.get("consumer_id"), actual.get("consumer_id"));
		assertEquals(usageReport.get("plan_id"), actual.get("plan_id"));
		assertEquals(usageReport.get("resource_instance_id"), actual.get("resource_instance_id"));

		assertNotEquals(usageReport.get("start"), actual.get("start"));
		assertNotEquals(usageReport.get("end"), actual.get("end"));

		JSONArray testdata_measured_usage_arr = (JSONArray) usageReport.get("measured_usage");
		JSONObject testdata_measured_usage_1 = (JSONObject) testdata_measured_usage_arr.get(0);
		JSONObject testdata_measured_usage_2 = (JSONObject) testdata_measured_usage_arr.get(1);
		JSONObject testdata_measured_usage_3 = (JSONObject) testdata_measured_usage_arr.get(2);
		JSONObject testdata_measured_usage_4 = (JSONObject) testdata_measured_usage_arr.get(3);

		JSONArray actual_measured_usage_arr = (JSONArray) actual.get("measured_usage");
		JSONObject actual_measured_usage_1 = (JSONObject) actual_measured_usage_arr.get(0);
		JSONObject actual_measured_usage_2 = (JSONObject) actual_measured_usage_arr.get(1);
		JSONObject actual_measured_usage_3 = (JSONObject) actual_measured_usage_arr.get(2);
		JSONObject actual_measured_usage_4 = (JSONObject) actual_measured_usage_arr.get(3);

		assertEquals(testdata_measured_usage_1.get("measure"), actual_measured_usage_1.get("measure"));
		assertEquals(testdata_measured_usage_1.get("quantity"), actual_measured_usage_1.get("quantity"));
		assertEquals(testdata_measured_usage_2.get("measure"), actual_measured_usage_2.get("measure"));
		assertEquals(testdata_measured_usage_2.get("quantity"), actual_measured_usage_2.get("quantity"));
		assertEquals(testdata_measured_usage_3.get("measure"), actual_measured_usage_3.get("measure"));
		assertEquals(testdata_measured_usage_3.get("quantity"), actual_measured_usage_3.get("quantity"));
		assertEquals(testdata_measured_usage_4.get("measure"), actual_measured_usage_4.get("measure"));
		assertEquals(testdata_measured_usage_4.get("quantity"), actual_measured_usage_4.get("quantity"));

	}

	@After
	public void release() throws Exception {
		dummyConnSecured = null;
		sampleMeteringReportService = null;
	}
}
