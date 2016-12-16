package org.openpaas.servicebroker.mongodb.service.impl;

import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.X509Certificate;
import java.sql.Timestamp;
import java.time.LocalDateTime;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import org.json.JSONArray;
import org.json.JSONObject;
import org.openpaas.servicebroker.exception.ServiceBrokerException;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;
import org.openpaas.servicebroker.service.SampleMeteringReportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SampleMeteringReportServiceImpl implements SampleMeteringReportService {
	
	private static final Logger logger = LoggerFactory.getLogger(MongoServiceInstanceBindingService.class);

	@Value("${abacus.collector}")
	String collectorUrl;

	@Value("${abacus.secured}")
	String abacusSecured;
	
	// 미터링 리포트용 상수
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
	private static final String SECURED = "true";

	/***************************************************
	 * @description : SampleMeteringReportService 를 구현한다.
	 * @title : reportServiceInstanceBinding
	 * @return : int (HTTPSTATUS)
	 ***************************************************/
	@Override
	public int reportServiceInstanceBinding(ServiceInstanceBinding binding, String uaaToken) throws ServiceBrokerException {
		try {
			validateBinding(binding);		
		} catch (Exception e) {
			return 400;
		}
		JSONObject serviceUsage = buildServiceUsage(binding, BIND);
		if (SECURED.equals(abacusSecured)) {
			reportBindingInfoHTTPS(serviceUsage, uaaToken);
		} else {
			reportBindingInfoHTTP(serviceUsage );
		}
		
		return 200;			
	}
	
	/***************************************************
	 * @description : 바인딩 객체를 체크 한다.
	 * @title : validateBinding
	 * @return : void
	 ***************************************************/
	public void validateBinding(ServiceInstanceBinding binding) throws Exception {
		if("".equals(binding.getAppOrganizationId()) || binding.getAppOrganizationId()==null){
			throw new Exception("organizataion guid is null");
		} else if("".equals(binding.getAppSpaceId()) || binding.getAppSpaceId()==null){
			throw new Exception("space guid is null");
		} else if ("".equals(binding.getAppGuid()) || binding.getAppGuid()==null){
			throw new Exception("app guid id is null");
		} else if ("".equals(binding.getMeteringPlanId()) || binding.getMeteringPlanId()==null){
			throw new Exception("metering plan id is null");
		} 
	}

	/***************************************************
	 * @description : SampleMeteringReportService 를 구현한다.
	 * @title : reportServiceInstanceBindingDelete
	 * @return : int (HTTPSTATUS)
	 ***************************************************/
	@Override
	public int reportServiceInstanceBindingDelete(ServiceInstanceBinding binding, String uaaToken) throws ServiceBrokerException {
		try {
			validateBinding(binding);
		} catch (Exception e) {
			return 400;
		}
		JSONObject serviceUsage = buildServiceUsage(binding, UNBIND);
		reportBindingInfoHTTPS(serviceUsage, uaaToken);
		return 200;	
	}

	/***************************************************
	 * @description : SSL 커넥션을 취득한다.
	 * @title : getConnetionHTTPS
	 * @return : HttpsURLConnection
	 ***************************************************/
	public HttpsURLConnection getConnetionHTTPS(String cUrl)
			throws ServiceBrokerException, NoSuchAlgorithmException, KeyManagementException, IOException {

		HttpsURLConnection conn1;
		TrustManager[] trustAllCerts = new TrustManager[] { new X509TrustManager() {
			public java.security.cert.X509Certificate[] getAcceptedIssuers() {
				return null;
			}

			public void checkClientTrusted(X509Certificate[] certs, String authType) {
			}

			public void checkServerTrusted(X509Certificate[] certs, String authType) {
			}
		} };

		SSLContext sc = SSLContext.getInstance("SSL");
		sc.init(null, trustAllCerts, new java.security.SecureRandom());
		HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
		URL url = new URL(cUrl);
		conn1 = (HttpsURLConnection) url.openConnection();
		return conn1;
	}

	/***************************************************
	 * @description : HTTP 커넥션을 생성한다.(HTTP)
	 * @title : getConnetionHTTP
	 * @return : HttpURLConnection
	 ***************************************************/
	public HttpURLConnection getConnetionHTTP(String cUrl) throws IOException {
		URL url = new URL(cUrl);
		URLConnection con = url.openConnection();
		HttpURLConnection http = (HttpURLConnection) con;
		return http;
	}

	/***************************************************
	 * @description : 바인딩 정보를 어버커스 에 전송한다.(HTTPS)
	 * @title : reportBindingInfoHTTPS
	 * @return : void
	 * @throws ServiceBrokerException 
	 ***************************************************/
	public int reportBindingInfoHTTPS(JSONObject serviceUsage, String uaaToken) throws ServiceBrokerException{

		StringBuffer sb = new StringBuffer();

		try {

			HttpsURLConnection conn = getConnetionHTTPS(collectorUrl);
			conn.setRequestMethod("POST");
			conn.setDoInput(true);
			conn.setDoOutput(true);
			conn.setUseCaches(false);
			conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

			// String bareStr = "bearer " + getUAAToken();
			String bareStr = "bearer " + uaaToken;
			conn.setRequestProperty("Authorization", bareStr);

			byte[] out = serviceUsage.toString().getBytes(StandardCharsets.UTF_8);

			DataOutputStream dout = new DataOutputStream(conn.getOutputStream());
			dout.write(out);
			dout.close();

			InputStreamReader in = new InputStreamReader((InputStream) conn.getInputStream());
			BufferedReader br = new BufferedReader(in);

			String line;
			while ((line = br.readLine()) != null) {
				sb.append(line).append("\n");
			}

			//System.out.println(sb.toString());

			br.close();
			in.close();
			conn.disconnect();

		} catch (Exception e) {
			e.printStackTrace();
			logger.error(e.toString());
			throw new ServiceBrokerException(e.toString());
		}
		
		return 200;
	}

	/***************************************************
	 * @description : 바인딩 정보를 리포팅한다.(HTTP)
	 * @title : reportBindingInfoHTTP
	 * @return : void
	 * @throws ServiceBrokerException 
	 * @throws NoSuchAlgorithmException
	 * @throws KeyManagementException
	 ***************************************************/
	public int reportBindingInfoHTTP(JSONObject serviceUsage) throws ServiceBrokerException{

		try {

			HttpURLConnection conn = getConnetionHTTP(collectorUrl);

			conn.setRequestMethod("POST"); // PUT is another valid option
			conn.setDoOutput(true);
			conn.setDoInput(true);
			conn.setUseCaches(false);

			byte[] out = serviceUsage.toString().getBytes(StandardCharsets.UTF_8);
			int length = out.length;

			conn.setFixedLengthStreamingMode(length);
			conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
			conn.connect();

			try (OutputStream os = conn.getOutputStream()) {
				os.write(out);
			}

		} catch (IOException e) {
			e.printStackTrace();
			logger.error(e.toString());
			//return HttpStatus.SC_INTERNAL_SERVER_ERROR;
			throw new ServiceBrokerException(e.toString());
		}
		
		return 200;
	}

	/***************************************************
	 * @description : 리포트 용 JSON 생성
	 * @title : buildServiceUsage
	 * @return : JSONObject
	 ***************************************************/
	public JSONObject buildServiceUsage(ServiceInstanceBinding binding, int mode) {

		String orgId = (String) binding.getAppOrganizationId();
		String spaceId = (String) binding.getAppSpaceId();
		String planId = (String) binding.getMeteringPlanId();
		String appId = (String) binding.getAppGuid();

		LocalDateTime now = LocalDateTime.now();
		Timestamp timestamp = Timestamp.valueOf(now);

		JSONObject jsonObjectUsage = new JSONObject();

		jsonObjectUsage.put("start", timestamp.getTime());
		jsonObjectUsage.put("end", timestamp.getTime());
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