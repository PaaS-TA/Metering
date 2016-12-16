package org.openpaas.servicebroker.mongodb.meteringTest;

import static org.junit.Assert.assertEquals;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import javax.net.ssl.HttpsURLConnection;

// import org.apache.commons.codec.binary.Base64;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mockito;
import org.mockito.Spy;
import org.openpaas.servicebroker.model.fixture.UsageReportFixture;
import org.openpaas.servicebroker.mongodb.service.impl.SampleMeteringOAuthServiceImpl;
import org.powermock.api.mockito.PowerMockito;
import org.powermock.core.classloader.annotations.PowerMockIgnore;
import org.powermock.core.classloader.annotations.PrepareForTest;
import org.powermock.modules.junit4.PowerMockRunner;
import org.springframework.test.util.ReflectionTestUtils;

@PowerMockIgnore("javax.net.ssl.*")
@RunWith(PowerMockRunner.class)
@PrepareForTest(value = { SampleMeteringOAuthServiceImpl.class})
public class SampleMeteringOAuthServiceUnitTest {
	
	@Spy
	SampleMeteringOAuthServiceImpl sampleMeteringOauthService = new SampleMeteringOAuthServiceImpl();

	HttpsURLConnection dummyUAAConn;	
	String testAuthServerUrl = "https://dummyCollectUrl.com/oauth/token?grant_type=client_credentials&scope=abacus.usage.linux-container.write%2Cabacus.usage.linux-container.read";	

	@Before
	public void setup() throws Exception {	

		ReflectionTestUtils.setField(sampleMeteringOauthService, "authServer", testAuthServerUrl);		
		ReflectionTestUtils.setField(sampleMeteringOauthService, "clientId", "abacus-linux-container");
		ReflectionTestUtils.setField(sampleMeteringOauthService, "clientSecret", "secret");
		ReflectionTestUtils.setField(sampleMeteringOauthService, "scope", "abacus.usage.linux-container.write,abacus.usage.linux-container.read");
		ReflectionTestUtils.setField(sampleMeteringOauthService, "abacusSecured", "true");
		
		dummyUAAConn = PowerMockito.mock(HttpsURLConnection.class);
		
		// 더비 프로토콜을 설정한다.
		URL url = PowerMockito.mock(URL.class);				
		PowerMockito.whenNew(URL.class).withParameterTypes(String.class)
        .withArguments(Mockito.anyString()).thenReturn(url);
		PowerMockito.when(url.openConnection()).thenReturn(dummyUAAConn);
		
		OutputStream tdout = PowerMockito.mock(OutputStream.class);
		JSONObject serviceUsage = UsageReportFixture.getUsageReportOnCreateBind();
		byte[] out = serviceUsage.toString().getBytes(StandardCharsets.UTF_8);
		tdout.write(out);
		
		PowerMockito.when(dummyUAAConn.getOutputStream()).thenReturn(tdout);

		dummyUAAConn.setRequestMethod("GET");
		dummyUAAConn.setDoInput(true);
        dummyUAAConn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        
        // UAA 서버의 response 를 mock 처리 한다.
        String accessTokenJSONStr = "{\"access_token\":\"dummyTokenFromDummyServer\",\"test\":\"test_String\"}";		
		InputStream anyInputStream = new ByteArrayInputStream(accessTokenJSONStr.getBytes());		
		PowerMockito.when(dummyUAAConn.getContent()).thenReturn(anyInputStream);			
		
/*		InputStreamReader in = new InputStreamReader((InputStream) dummyUAAConn.getContent());
        PowerMockito.whenNew(InputStreamReader.class).withArguments(uaaAnyInputStream).thenReturn(in);
        
    	BufferedReader br = new BufferedReader(in);
    	PowerMockito.whenNew(BufferedReader.class).withArguments(in).thenReturn(br);*/
		
		PowerMockito.when(sampleMeteringOauthService.getConnetionUAA()).thenReturn(dummyUAAConn);

	}
	
	@SuppressWarnings("static-access")
	@Test
	public void allTest() throws Exception {

		String responsedToken = "dummyTokenFromDummyServer";
		String testResponsedToken = sampleMeteringOauthService.getUAAToken();
		
		assertEquals(responsedToken, testResponsedToken);
	}

	@Test
	public void getAuthKeyTest() throws Exception {		
		
		// getAuthKey test
		String testAuthStr = sampleMeteringOauthService.getAuthKey("abacus-linux-container", "secret");
		String maybeRtnAuthStr = "Basic YWJhY3VzLWxpbnV4LWNvbnRhaW5lcjpzZWNyZXQ=";
		
		assertEquals(testAuthStr, maybeRtnAuthStr);
	}
	
	@SuppressWarnings("static-access")
	@Test
	public void encodeURIComponentTest() throws Exception {
		
		// encodeURIComponent test
		String testEncodeStr = sampleMeteringOauthService.encodeURIComponent("abacus.usage.linux-container.write,abacus.usage.linux-container.read");
		String maybeRtnEncodeStr = "abacus.usage.linux-container.write%2Cabacus.usage.linux-container.read";
		
		assertEquals(testEncodeStr, maybeRtnEncodeStr);
	}
	
	@SuppressWarnings("static-access")
	@Test
	public void parseAuthTokenTest() throws Exception {
				
		// parseAuthToken test
		String accessTokenJSONStr2 = "{\"access_token\":\"dummyTokenFromDummyServer\",\"test\":\"test_String\"}";
		String testParseStr= sampleMeteringOauthService.parseAuthToken(accessTokenJSONStr2);
		String maybeRtnParseStr = "dummyTokenFromDummyServer";
		
		assertEquals(testParseStr, maybeRtnParseStr);
	}
	
	@After
	public void release() throws Exception {	
		
		ReflectionTestUtils.setField(sampleMeteringOauthService, "authServer", "");		
		ReflectionTestUtils.setField(sampleMeteringOauthService, "clientId", "");
		ReflectionTestUtils.setField(sampleMeteringOauthService, "clientSecret", "");
		ReflectionTestUtils.setField(sampleMeteringOauthService, "scope", "");
		
		dummyUAAConn = null;
		sampleMeteringOauthService = null;
	}

}
