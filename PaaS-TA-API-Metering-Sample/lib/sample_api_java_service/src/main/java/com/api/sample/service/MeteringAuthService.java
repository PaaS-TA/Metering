package com.api.sample.service;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLEncoder;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.ws.rs.core.MultivaluedMap;

import org.apache.commons.codec.binary.Base64;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

import com.sun.jersey.api.client.Client;
import com.sun.jersey.api.client.ClientResponse;
import com.sun.jersey.api.client.WebResource;
import com.sun.jersey.core.util.MultivaluedMapImpl;

@Component
@Service
public class MeteringAuthService {
	
	// 개발형 플랫폼의 UAA server URL 
	@Value("${uaa.server}")
	String authServer;
		
	// UAA 계정 
	@Value("${uaa.client.id}")
	String clientId;
	
	// UAA 계정 비밀번호
	@Value("${uaa.client.secret}")
	String clientSecret;
	
	//  abacus usage collector 사용권한
	@Value("${uaa.client.scope}")
	String scope;

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : UAA 토큰을 습득한다. (HTTPS)
	 * @title : getUaacTokenHTTPS
	 * @return : String
	 ***************************************************/
	public String getUaacTokenHTTPS() throws MalformedURLException {
		
		String authToken = "";

		String urlStr = authServer + "/oauth/token?grant_type=client_credentials&scope=" + encodeURIComponent(scope);
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

			URL url = new URL(urlStr);
			HttpURLConnection conn = (HttpURLConnection) url.openConnection();
	        conn.setRequestMethod("GET");
	        conn.setDoInput(true);
	        String authHeader = getAuthKey(clientId, clientSecret);
	        conn.setRequestProperty("authorization", authHeader);

			InputStreamReader in = new InputStreamReader((InputStream) conn.getContent());
			BufferedReader br = new BufferedReader(in);

			String line;
			while ((line = br.readLine()) != null) {
				sb.append(line).append("\n");
			}

			System.out.println(sb.toString());
			
			authToken= parseAuthToken(sb.toString());
			
			System.out.println("authToken::" + authToken);		
			
			br.close();
			in.close();
			conn.disconnect();

		} catch (Exception e) {
			System.out.println(e.toString());
		}

		return authToken;
	}
		
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 인증 header 를 작성한다.(Base64)
	 * @title : getAuthKey
	 * @return : String
	 ***************************************************/
	public String getAuthKey(String id, String secret) throws Exception {
		
		String authKey = ""; 
		
		try {
		
			String encodedConsumerKey = URLEncoder.encode(id, "UTF-8");
			String encodedConsumerSecret = URLEncoder.encode(secret, "UTF-8");
			String fullKey = encodedConsumerKey + ":" + encodedConsumerSecret;
			byte[] encodedBytes = Base64.encodeBase64(fullKey.getBytes());
			
			authKey = "Basic " + new String(encodedBytes);
		
		} catch (Exception e) {
			e.printStackTrace();			
			throw e;
		}
		
		return authKey;
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : UAA 토큰을 습득한다. (HTTP)
	 * @title : getUaacTokenHTTP
	 * @return : String
	 ***************************************************/
	public String getUaacTokenHTTP() throws MalformedURLException {
		
		String authToken = "";

		try {

			Client client = Client.create();
			WebResource webResource = client.resource(authServer + "/oauth/token?grant_type=client_credentials&scope=" + encodeURIComponent(scope));

			MultivaluedMap<String, String> queryParams = new MultivaluedMapImpl();
			queryParams.add("json", ""); // set dummy parametes 

			String authHeader = getAuthKey(clientId, clientSecret);

			ClientResponse response = null;
			response = webResource.queryParams(queryParams).header("Content-Type", "application/json;charset=UTF-8")
					.header("Authorization", authHeader).get(ClientResponse.class);

			String jsonStr = response.getEntity(String.class);
			authToken= parseAuthToken(jsonStr);
		} catch (Exception e) {
			e.printStackTrace();
			System.out.println(e);
		}
		return authToken;
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 특수문자를 인코드한다.
	 * @title : encodeURIComponent
	 * @return : String
	 ***************************************************/
	public static String encodeURIComponent(String s) {
		String result = null;
		try {
			result = URLEncoder.encode(s, "UTF-8").replaceAll("\\+", "%20").replaceAll("\\%21", "!")
					.replaceAll("\\%27", "'").replaceAll("\\%28", "(").replaceAll("\\%29", ")")
					.replaceAll("\\%7E", "~");
		} catch (Exception e) { 
			result = s;
		} 
		return result;
	}
	
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : UAA SEVER 에서 리턴 받은 JSON 오브젝트 에서 access_token 을 추출한다.
	 * @title : parseAuthToken
	 * @return : String
	 ***************************************************/
	private String parseAuthToken(String jsonStr) throws ParseException{		
		String barerStr;		
		JSONParser jsonParser = new JSONParser();
		JSONObject jsonObject = (JSONObject) jsonParser.parse(jsonStr);
		barerStr = (String) jsonObject.get("access_token");		
		return barerStr;
	}	
}
