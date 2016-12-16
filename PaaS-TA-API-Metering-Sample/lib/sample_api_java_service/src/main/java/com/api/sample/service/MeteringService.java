package com.api.sample.service;

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
import java.security.cert.X509Certificate;
import java.sql.Timestamp;
import java.time.LocalDateTime;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

@Component
@Service
public class MeteringService {

	// abacus-usage-collector RESTAPI 의 주소  
	@Value("${abacus.collector}")
	String collectorUrl;

	// abacus usage collector 가 인증 모드인 경우 true / 아닐 경우 false
	@Value("${abacus.secured}")
	String abacusSecured;

	@Autowired
	private MeteringAuthService meteringAuthService;

	@Autowired
	public MeteringService(MeteringAuthService meteringAuthService) {
		this.meteringAuthService = meteringAuthService;
	}

	private static final String SECURED = "true";

	private static final String RESOURCE_ID = "object-storage";
	private static final String STANDARD_PLAN_ID = "standard";
	private static final String EXTRA_PLAN_ID = "extra";

	private static final String MEASURE_1 = "storage";
	private static final String MEASURE_2 = "light_api_calls";
	private static final String MEASURE_3 = "heavy_api_calls";

	private static final int PLAN_STANDARD_QUANTITY = 100;
	private static final int PLAN_EXTRA_QUANTITY = 1000;

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 서비스 사용 정보를 아바커스로 전송한다.
	 * @title : reportBindingCreate
	 * @return : void
	 ***************************************************/
	public void reportUsageData(String orgId, String spaceId, String appId, String planId) throws Exception {

		JSONObject serviceUsage = buildServiceUsage(orgId, spaceId, appId, planId);

		// abacus usage collector 가 인증 모드인 경우 true / 아닐 경우 false
		if (SECURED.equals(abacusSecured)) {
			reportUsageDataHTTPS(serviceUsage);
		} else {
			reportUsageDataHTTP(serviceUsage);
		}
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 바인딩 정보를 어버커스 에 전송한다.(HTTPS)
	 * @title : reportUsageDataHTTPS
	 * @return : void
	 ***************************************************/
	public void reportUsageDataHTTPS(JSONObject serviceUsage) throws Exception {

		StringBuffer sb = new StringBuffer();

		try {
			// 인증서를 생성 한다.
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
			
			// 생성한 인증서를 HttpsURLConnection 에 세팅 한다.
			HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());

			URL url = new URL(collectorUrl);
			HttpURLConnection conn = (HttpURLConnection) url.openConnection();
			conn.setRequestMethod("POST");
			conn.setDoInput(true);
			conn.setDoOutput(true);
			conn.setUseCaches(false);

			conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
			
			// UAA Server 에서 취득한 토큰을 세팅한다.
			String bareStr = "bearer " + meteringAuthService.getUaacTokenHTTPS();
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

			System.out.println(sb.toString());
			System.out.println(serviceUsage + " was repoerted.");

			br.close();
			in.close();
			conn.disconnect();

		} catch (Exception e) {
			Exception se = new Exception(e);
			throw se;
		}
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : abacus 바인딩 정보를 리포팅한다.(HTTP)
	 * @title : reportUsageDataHTTP
	 * @return : void
	 ***************************************************/
	public void reportUsageDataHTTP(JSONObject serviceUsage) throws Exception {

		try {
			URL url = new URL(collectorUrl);
			URLConnection con = url.openConnection();
			HttpURLConnection http = (HttpURLConnection) con;
			http.setRequestMethod("POST"); // PUT is another valid option
			http.setDoOutput(true);
			http.setDoInput(true);
			http.setUseCaches(false);

			byte[] out = serviceUsage.toString().getBytes(StandardCharsets.UTF_8);
			int length = out.length;

			http.setFixedLengthStreamingMode(length);
			http.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
			http.connect();

			try (OutputStream os = http.getOutputStream()) {
				os.write(out);
			}

		} catch (IOException e) {
			e.printStackTrace();
			throw new Exception(e);
		}
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 리포트 용 JSON 생성
	 * @title : buildServiceUsage
	 * @return : JSONObject
	 * @throws JSONException
	 ***************************************************/
	private JSONObject buildServiceUsage(String orgId, String spaceId, String appId, String planId)
			throws JSONException {

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

		int quantity = 0;

		if (STANDARD_PLAN_ID.equals(planId)) {
			quantity = PLAN_STANDARD_QUANTITY;
		} else if (EXTRA_PLAN_ID.equals(planId)) {
			quantity = PLAN_EXTRA_QUANTITY;
		}

		measuredUsage1.put("measure", MEASURE_1);
		measuredUsage1.put("quantity", quantity);
		measuredUsageArr.put(measuredUsage1);
		measuredUsage2.put("measure", MEASURE_2);
		measuredUsage2.put("quantity", 1);
		measuredUsageArr.put(measuredUsage2);
		measuredUsage3.put("measure", MEASURE_3);
		measuredUsage3.put("quantity", 0);
		measuredUsageArr.put(measuredUsage3);

		jsonObjectUsage.put("measured_usage", measuredUsageArr);
		return jsonObjectUsage;
	}

}