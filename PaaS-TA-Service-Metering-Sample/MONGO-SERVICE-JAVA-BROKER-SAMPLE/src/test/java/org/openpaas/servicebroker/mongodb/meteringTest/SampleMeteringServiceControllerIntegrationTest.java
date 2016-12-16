package org.openpaas.servicebroker.mongodb.meteringTest;

import static org.hamcrest.Matchers.is;
import static org.mockito.Matchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.mockito.Spy;
import org.openpaas.servicebroker.controller.ServiceInstanceBindingController;
import org.openpaas.servicebroker.model.CreateServiceInstanceBindingRequest;
import org.openpaas.servicebroker.model.ServiceInstance;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;
import org.openpaas.servicebroker.model.fixture.ServiceInstanceBindingFixture;
import org.openpaas.servicebroker.model.fixture.ServiceInstanceFixture;
import org.openpaas.servicebroker.model.fixture.UsageReportFixture;
import org.openpaas.servicebroker.mongodb.service.impl.SampleMeteringOAuthServiceImpl;
import org.openpaas.servicebroker.mongodb.service.impl.SampleMeteringReportServiceImpl;
import org.openpaas.servicebroker.service.ServiceInstanceBindingService;
import org.openpaas.servicebroker.service.ServiceInstanceService;
import org.powermock.api.mockito.PowerMockito;
import org.powermock.core.classloader.annotations.PowerMockIgnore;
import org.powermock.core.classloader.annotations.PrepareForTest;
import org.powermock.modules.junit4.PowerMockRunner;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.MethodArgumentNotValidException;

@PowerMockIgnore("javax.net.ssl.*")
@RunWith(PowerMockRunner.class)
@PrepareForTest({ SampleMeteringReportServiceImpl.class })
public class SampleMeteringServiceControllerIntegrationTest {

	private static final String BASE_PATH = "/v2/service_instances/"
			+ ServiceInstanceFixture.getServiceInstance().getServiceInstanceId() + "/service_bindings";

	MockMvc mockMvc;

	@InjectMocks
	ServiceInstanceBindingController controller;

	@Mock
	ServiceInstanceBindingService serviceInstanceBindingService;

	@Mock
	ServiceInstanceService serviceInstanceService;

	@Mock
	SampleMeteringOAuthServiceImpl sampleMeteringOAuthService;

	@Spy
	SampleMeteringReportServiceImpl sampleMeteringReportService = new SampleMeteringReportServiceImpl();

	HttpsURLConnection dummyConnSecured;
	HttpURLConnection dummyConn;

	String testCollectorUrlSecured = "https://dummyCollectUrl.com";
	String testCollectorUrl = "http://dummyCollectUrl.com";

	HttpsURLConnection dummyUAAConn;
	String testAuthServerUrl = "https://dummyCollectUrl.com/oauth/token?grant_type=client_credentials&scope=abacus.usage.linux-container.write%2Cabacus.usage.linux-container.read";

	@Before
	public void setup() throws Exception {

		try {

			// 컨트롤러
			MockitoAnnotations.initMocks(this);

			this.mockMvc = MockMvcBuilders.standaloneSetup(controller)
					.setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

			// sampleMeteringReportService 의 URL 커넥션 Mock 처리
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

		} catch (Exception e) {
			e.printStackTrace();
			throw e;
		}

	}

	// 미터링 테스트 : 컨트롤러 결합 테스트 (바인딩)
	@Test
	public void sampleMeteringReportServiceCorrectly() throws Exception {
		ServiceInstance instance = ServiceInstanceFixture.getServiceInstance();
		ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();

		// 프로퍼티 파일의 값을 세팅한다.
		ReflectionTestUtils.setField(sampleMeteringReportService, "collectorUrl", "https://dummyCollectUrl.com");
		ReflectionTestUtils.setField(sampleMeteringReportService, "abacusSecured", "true");

		PowerMockito.when(serviceInstanceService.getServiceInstance(any(String.class))).thenReturn(instance);
		PowerMockito
				.when(serviceInstanceBindingService
						.createServiceInstanceBinding(any(CreateServiceInstanceBindingRequest.class)))
				.thenReturn(binding);

		PowerMockito.when(sampleMeteringOAuthService.getUAAToken()).thenReturn("dummyTokenFromDummyServer");

		// Secure mode 테스트
		PowerMockito.when(sampleMeteringReportService.getConnetionHTTPS(testCollectorUrlSecured))
				.thenReturn(dummyConnSecured);

		String uaaToken = "dummyTokenFromDummyServer";
		sampleMeteringReportService.reportServiceInstanceBinding(binding, uaaToken);

		String url = BASE_PATH + "/{bindingId}";
		String body = ServiceInstanceBindingFixture.getServiceInstanceBindingRequestJson();

		mockMvc.perform(put(url, binding.getId()).contentType(MediaType.APPLICATION_JSON).content(body))
				.andExpect(status().isCreated())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.credentials.uri", is("uri")))
				.andExpect(jsonPath("$.credentials.username", is("username")))
				.andExpect(jsonPath("$.credentials.password", is("password")));
	}

	// 미터링 테스트 : 컨트롤러 결합 테스트 (바인딩)
	@Test
	public void wrongBindingParameterInputTest() throws Exception {

		try {
			// 프로퍼티 파일의 값을 세팅한다.
			ReflectionTestUtils.setField(sampleMeteringReportService, "collectorUrl", "https://dummyCollectUrl.com");
			ReflectionTestUtils.setField(sampleMeteringReportService, "abacusSecured", "true");

			ServiceInstance instance = ServiceInstanceFixture.getServiceInstance();
			ServiceInstanceBinding binding = ServiceInstanceBindingFixture.getServiceInstanceBinding();

			String url = BASE_PATH + "/{bindingId}";
			String body = "{}";

			PowerMockito.when(serviceInstanceService.getServiceInstance(any(String.class))).thenReturn(instance);
			PowerMockito
					.when(serviceInstanceBindingService
							.createServiceInstanceBinding(any(CreateServiceInstanceBindingRequest.class)))
					.thenReturn(binding);

			// Secure mode 테스트
			PowerMockito.when(sampleMeteringReportService.getConnetionHTTPS(testCollectorUrlSecured))
					.thenReturn(dummyConnSecured);

			String uaaToken = "test";

			binding.setAppOrganizationId("");
			sampleMeteringReportService.reportServiceInstanceBinding(binding, uaaToken);

			mockMvc.perform(put(url, binding.getId()).contentType(MediaType.APPLICATION_JSON).content(body))
					.andExpect(status().is4xxClientError()); // 422

		} catch (MethodArgumentNotValidException e) {
			// MethodArgumentNotValidException 를 발생 시키는 테스트
			System.out.println("Expected MethodArgumentNotValidException Happend.");
		}
	}

	@After
	public void release() throws Exception {
		mockMvc = null;
		dummyConnSecured = null;
		dummyUAAConn = null;
	}

}
