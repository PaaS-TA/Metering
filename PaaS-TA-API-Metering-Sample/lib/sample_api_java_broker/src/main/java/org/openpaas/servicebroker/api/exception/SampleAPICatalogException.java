package org.openpaas.servicebroker.api.exception;

import org.openpaas.servicebroker.exception.ServiceBrokerException;



public class SampleAPICatalogException extends ServiceBrokerException{

	private static final long serialVersionUID = 139013461006947252L;

	public SampleAPICatalogException(int status, String message) {
		super(message);
				
	}
	
	public SampleAPICatalogException(String message){
		super(message);
	}

}
