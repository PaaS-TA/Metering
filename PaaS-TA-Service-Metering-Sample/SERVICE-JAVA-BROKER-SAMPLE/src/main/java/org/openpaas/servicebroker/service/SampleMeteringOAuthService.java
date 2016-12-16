package org.openpaas.servicebroker.service;

import org.openpaas.servicebroker.exception.ServiceBrokerException;

public interface SampleMeteringOAuthService {
	
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : UAA 토큰을 습득한다. (HTTPS)
	 * @title : getUaacTokenHTTPS
	 * @return : String
	 ***************************************************/
	String getUAAToken() throws ServiceBrokerException;
}
