package org.openpaas.servicebroker.mongodb.service.impl;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.net.URLEncoder;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.X509Certificate;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import org.apache.commons.codec.binary.Base64;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.json.simple.parser.ParseException;
import org.openpaas.servicebroker.exception.ServiceBrokerException;
import org.openpaas.servicebroker.service.SampleMeteringOAuthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;

@Component
@Service
public class SampleMeteringOAuthServiceImpl implements SampleMeteringOAuthService {
	
	@Value("${uaa.server}")
	String authServer;
	
	@Value("${uaa.client.id}")
	String clientId;
	
	@Value("${uaa.client.secret}")
	String clientSecret;
	
	@Value("${uaa.client.scope}")
	String scope;
	
	@Value("${abacus.secured}")
	String abacusSecured;
		
	private static final String SECURED = "true";
	
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : UAA 토큰을 습득한다. (HTTPS)
	 * @title : getUaacTokenHTTPS
	 * @return : String
	 ***************************************************/
	@Override
	public String getUAAToken() throws ServiceBrokerException {
		
		if(!SECURED.equals(abacusSecured)){
			return "";
		} else {
			String authToken = "";		
			StringBuffer sb = new StringBuffer();

			try {
			
				HttpsURLConnection conn = (HttpsURLConnection) getConnetionUAA();
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

				authToken= parseAuthToken(sb.toString());

				br.close();
				in.close();
				conn.disconnect();

			} catch (Exception e) {
				e.printStackTrace();
				//System.out.println(e.toString());
				throw new ServiceBrokerException(e.toString());
			}
			return authToken;
		}		
	}	
	
	public HttpsURLConnection getConnetionUAA()
			throws ServiceBrokerException, NoSuchAlgorithmException, KeyManagementException, IOException {
		
		HttpsURLConnection conn1 = null;
		
		try {
			String urlStr = authServer + "/oauth/token?grant_type=client_credentials&scope=" + encodeURIComponent(scope);
			
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
			URL url = new URL(urlStr);
			conn1 = (HttpsURLConnection) url.openConnection();
			
		} catch (Exception e) {
			e.printStackTrace();
			//.out.println(e);
			throw e;
		}
		
		return conn1;		

	}


		
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 인증 header 를 작성한다.(Base64)
	 * @title : getAuthKey
	 * @return : String
	 ***************************************************/
	public static String getAuthKey(String id, String secret) throws Exception {
		
		String authKey = ""; 
		
		try {		
			String encodedConsumerKey = URLEncoder.encode(id, "UTF-8");
			String encodedConsumerSecret = URLEncoder.encode(secret, "UTF-8");
			String fullKey = encodedConsumerKey + ":" + encodedConsumerSecret;
			byte[] encodedBytes = Base64.encodeBase64(fullKey.getBytes());			
			authKey = "Basic " + new String(encodedBytes);		
		} catch (Exception e) {
			return authKey;
		}
		
		return authKey;
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
	public static String parseAuthToken(String jsonStr) throws ParseException{		
		String barerStr;		
		JSONParser jsonParser = new JSONParser();
		JSONObject jsonObject = (JSONObject) jsonParser.parse(jsonStr);
		barerStr = (String) jsonObject.get("access_token");		
		return barerStr;
	}

}
