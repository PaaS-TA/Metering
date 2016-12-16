package org.openpaas.servicebroker.model;

import java.util.HashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 서비스 인스턴스 바인드된 정보를 가지고 있는 데이터 모델 bean 클래스. 
 * Json 어노테이션을 사용해서 JSON 형태로 제공
 * 
 */

public class ServiceInstanceBinding {

	private String id;
	private String serviceInstanceId;
	private Map<String,Object> credentials = new HashMap<String,Object>();
	private String syslogDrainUrl;
	// 미터링에 사용되는 필드
	private String appGuid;
	
	// 미터링을 위해 추가 된 필드
	private String appOrganizationId; // 서비스를 사용하는 애플리케이션의 조직아이디
	private String appSpaceId; // 서비스를 사용하는 애플리케이션의 영역아이디
	private String meteringPlanId; // 서비스에서 사용하는 미터링 아이디
	
	@JsonIgnore
	private HttpStatus httpStatus = HttpStatus.CREATED;
	
	public ServiceInstanceBinding(String id, 
			String serviceInstanceId, 
			Map<String,Object> credentials,
			String syslogDrainUrl, String appGuid,
			String appOrganizationId,
			String appSpaceId,
			String meteringPlanId			
			) {
		this.id = id;
		this.serviceInstanceId = serviceInstanceId;
		setCredentials(credentials);
		this.syslogDrainUrl = syslogDrainUrl;
		this.appGuid = appGuid;
		
		this.appOrganizationId = appOrganizationId;		
		this.appSpaceId = appSpaceId;		
		this.meteringPlanId = meteringPlanId;
	}

	public String getId() {
		return id;
	}
	
	public void setId(String id) {
		this.id = id;
	}

	public String getServiceInstanceId() {
		return serviceInstanceId;
	}

	public Map<String, Object> getCredentials() {
		return credentials;
	}

	public void setServiceInstanceId(String serviceInstanceId) {
		this.serviceInstanceId = serviceInstanceId;
	}

	private void setCredentials(Map<String, Object> credentials) {
		if (credentials == null) {
			credentials = new HashMap<String,Object>();
		} else {
			this.credentials = credentials;
		}
	}

	public String getSyslogDrainUrl() {
		return syslogDrainUrl;
	}
	
	public String getAppGuid() {
		return appGuid;
	}
	
	public void setHttpStatusOK(){
		this.httpStatus=HttpStatus.OK;
	}
	
	public HttpStatus getHttpStatus(){
		return httpStatus;
	}

	public String getAppOrganizationId() {
		return appOrganizationId;
	}

	public void setAppOrganizationId(String appOrganizationId) {
		this.appOrganizationId = appOrganizationId;
	}

	public String getAppSpaceId() {
		return appSpaceId;
	}

	public void setAppSpaceId(String appSpaceId) {
		this.appSpaceId = appSpaceId;
	}

	public String getMeteringPlanId() {
		return meteringPlanId;
	}

	public void setMeteringPlanId(String meteringPlanId) {
		this.meteringPlanId = meteringPlanId;
	}	
	
}
