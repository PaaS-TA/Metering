package com.api.sample;

import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import com.api.sample.service.MeteringService;

@RestController
public class SampleApiJavaServiceController {

	private static final String SERVICE_KEY = "[cloudfoundry]";

	@Autowired
	private MeteringService meteringService;

	@Autowired
	public SampleApiJavaServiceController(MeteringService meteringService) {
		this.meteringService = meteringService;
	}

	/***************************************************
	 * @project : 서비스 미터링 샘플 (POST 방식인 경우)
	 * @description : 서비스 미터링 샘플 RESP API
	 * @title : servicePlan1ApiPOST
	 * @return : ResponseEntity
	 * @throws Exception
	 ***************************************************/
	@RequestMapping(value = "/plan1", method = RequestMethod.POST)
	public ResponseEntity<String> serviceAPIPlan01(@RequestBody String input) throws Exception {
		
		JSONParser jsonParser = new JSONParser();
		JSONObject jsonObject = (JSONObject) jsonParser.parse(input);
		
		String orgId = (String) jsonObject.get("organization_id");
		String spaceId = (String) jsonObject.get("space_id");	
		String appId = (String) jsonObject.get("consumer_id");	
		String planId = (String) jsonObject.get("plan_id");	
		JSONObject serviceKeyOBJ = (JSONObject) jsonObject.get("credential");	
		String serviceKey = (String) serviceKeyOBJ.get("serviceKey");	
		
		// credential 로 넘어온 serviceKey 가 일치 하지 않는 경우 인증 에러 처리
		if(!SERVICE_KEY.equals(serviceKey))
			return new ResponseEntity<>("credential is wrong", HttpStatus.UNAUTHORIZED);
		
		meteringService.reportUsageData(orgId, spaceId, appId, planId);		
		
		String successStr = "orgId:" + orgId + "/ spaceId:" + spaceId + "/ appId:" + appId + "/ planId:" + planId
				+ " was reported to abacus collecter.";
		
		return new ResponseEntity<>(successStr, HttpStatus.OK);
	}
}
