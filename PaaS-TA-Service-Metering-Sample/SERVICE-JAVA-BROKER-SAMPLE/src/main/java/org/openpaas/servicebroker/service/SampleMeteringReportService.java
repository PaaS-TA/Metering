package org.openpaas.servicebroker.service;

import org.openpaas.servicebroker.exception.ServiceBrokerException;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;

public interface SampleMeteringReportService {

	/***************************************************
	 * @description : 바인딩 정보를 어버커스 에 전송한다.(HTTPS)
	 * @title : reportServiceInstanceBinding
	 * @return : int (HTTP_STATUS)
	 * @throws ServiceBrokerException 
	 ***************************************************/
	int reportServiceInstanceBinding(ServiceInstanceBinding serviceInstanceBinding, 
			String uaaToken)
			throws ServiceBrokerException;

	/***************************************************
	 * @description : 언바인딩 정보를 어버커스 에 전송한다.(HTTPS)
	 * @title : reportServiceInstanceBindingDelete
	 * @return : int (HTTP_STATUS)
	 * @throws ServiceBrokerException 
	 ***************************************************/
	int reportServiceInstanceBindingDelete(ServiceInstanceBinding serviceInstanceBinding, 
			String uaaToken)
			throws ServiceBrokerException;	

}
