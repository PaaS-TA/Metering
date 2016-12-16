package org.openpaas.servicebroker.controller;


import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;

import org.openpaas.servicebroker.exception.ServiceBrokerException;
import org.openpaas.servicebroker.exception.ServiceInstanceBindingExistsException;
import org.openpaas.servicebroker.exception.ServiceInstanceDoesNotExistException;
import org.openpaas.servicebroker.model.CreateServiceInstanceBindingRequest;
import org.openpaas.servicebroker.model.DeleteServiceInstanceBindingRequest;
import org.openpaas.servicebroker.model.ErrorMessage;
import org.openpaas.servicebroker.model.ServiceInstance;
import org.openpaas.servicebroker.model.ServiceInstanceBinding;
import org.openpaas.servicebroker.model.ServiceInstanceBindingResponse;
import org.openpaas.servicebroker.service.SampleMeteringOAuthService;
import org.openpaas.servicebroker.service.SampleMeteringReportService;
import org.openpaas.servicebroker.service.ServiceInstanceBindingService;
import org.openpaas.servicebroker.service.ServiceInstanceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * 서비스 인스턴스 바인드 관련 Bind/Unbind API 를 호출 받는 컨트롤러이다.
 * 
 * @author 송창학
 * @date 2015.0629
 */

@Controller
public class ServiceInstanceBindingController extends BaseController {

	public static final String BASE_PATH = "/v2/service_instances/{instanceId}/service_bindings";
	
	private static final Logger logger = LoggerFactory.getLogger(ServiceInstanceBindingController.class);
	
	@Autowired
	private ServiceInstanceBindingService serviceInstanceBindingService;
	@Autowired
	private ServiceInstanceService serviceInstanceService;
	@Autowired
	private SampleMeteringOAuthService sampleMeteringOAuthService;
	@Autowired
	private SampleMeteringReportService sampleMeteringReportService;
	
	@Autowired
	public ServiceInstanceBindingController(ServiceInstanceBindingService serviceInstanceBindingService,
			ServiceInstanceService serviceInstanceService,
			SampleMeteringReportService sampleMeteringReportService,
			SampleMeteringOAuthService sampleMeteringOAuthService
			) {
		this.serviceInstanceBindingService = serviceInstanceBindingService;
		this.serviceInstanceService = serviceInstanceService;
		this.sampleMeteringReportService = sampleMeteringReportService;
		this.sampleMeteringOAuthService = sampleMeteringOAuthService;
	}
	
	@RequestMapping(value = BASE_PATH + "/{bindingId}", method = RequestMethod.PUT)
	public ResponseEntity<ServiceInstanceBindingResponse> bindServiceInstance(
			@PathVariable("instanceId") String instanceId, 
			@PathVariable("bindingId") String bindingId,
			@Valid @RequestBody CreateServiceInstanceBindingRequest request) throws
			ServiceInstanceDoesNotExistException, ServiceInstanceBindingExistsException, 
			ServiceBrokerException {
		logger.debug( "PUT: " + BASE_PATH + "/{bindingId}"
				+ ", bindServiceInstance(), serviceInstance.id = " + instanceId 
				+ ", bindingId = " + bindingId);
		ServiceInstance instance = serviceInstanceService.getServiceInstance(instanceId);
		if (instance == null) {
			throw new ServiceInstanceDoesNotExistException(instanceId);
		}
		ServiceInstanceBinding binding = serviceInstanceBindingService.createServiceInstanceBinding(
				request.withServiceInstanceId(instanceId).and().withBindingId(bindingId));
		
		// 미터링에 사용되기 때문에 null 체크한다.
		if (binding == null) {
			throw new ServiceBrokerException(bindingId);
		}
		
		// UAA 토큰을 UAA 서버로 부터 취득한다.
		String uaaToken = sampleMeteringOAuthService.getUAAToken();
		
		try {
			// 아바커스 사용량 컬렉터로 사용량을 전송 한다.
			int httpStatus = sampleMeteringReportService.reportServiceInstanceBinding(binding, uaaToken); 
			if (httpStatus == 400) { 
				throw new ServiceBrokerException(bindingId);
			} 	
		} catch (ServiceBrokerException e) {
			throw e;
		}
		
		logger.debug("ServiceInstanceBinding Created: " + binding.getId());
        return new ResponseEntity<ServiceInstanceBindingResponse>(
        		new ServiceInstanceBindingResponse(binding), 
        		binding.getHttpStatus());
	}
	
	@RequestMapping(value = BASE_PATH + "/{bindingId}", method = RequestMethod.DELETE)
	public ResponseEntity<String> deleteServiceInstanceBinding(
			@PathVariable("instanceId") String instanceId, 
			@PathVariable("bindingId") String bindingId,
			@RequestParam("service_id") String serviceId,
			@RequestParam("plan_id") String planId) throws ServiceBrokerException, ServiceInstanceDoesNotExistException {
		logger.debug( "DELETE: " + BASE_PATH + "/{bindingId}"
				+ ", deleteServiceInstanceBinding(),  serviceInstance.id = " + instanceId 
				+ ", bindingId = " + bindingId 
				+ ", serviceId = " + serviceId
				+ ", planId = " + planId);
        ServiceInstance instance = serviceInstanceService.getServiceInstance(instanceId);
        if (instance == null) {
            throw new ServiceInstanceDoesNotExistException(instanceId);
        }
		ServiceInstanceBinding binding = serviceInstanceBindingService.deleteServiceInstanceBinding(
		        new DeleteServiceInstanceBindingRequest( bindingId, instance, serviceId, planId));
		
		// 미터링 부분 START
		if (binding == null) {
			return new ResponseEntity<String>("{}", HttpStatus.GONE);
		}
		
		// UAA Server에서 Oauth Token을 취득 한다.
		String uaaToken = sampleMeteringOAuthService.getUAAToken();
		
		try {
			// 사용량 JSON을 생성 하여, abacus-collector 에 사용량 전송 한다.
			int httpStatus = sampleMeteringReportService.reportServiceInstanceBindingDelete(binding, uaaToken); 	
			if (httpStatus == 400) {
				throw new ServiceBrokerException(bindingId);
			} 	
		} catch (ServiceBrokerException e) {
			throw e;
		}	
		// 미터링 부분 END
		
		logger.debug("ServiceInstanceBinding Deleted: " + binding.getId());
        return new ResponseEntity<String>("{}", HttpStatus.OK);
	}
	
	@ExceptionHandler(ServiceInstanceDoesNotExistException.class)
	@ResponseBody
	public ResponseEntity<ErrorMessage> handleException(
			ServiceInstanceDoesNotExistException ex, 
			HttpServletResponse response) {
	    return getErrorResponse(ex.getMessage(), HttpStatus.UNPROCESSABLE_ENTITY);
	}
	
	@ExceptionHandler(ServiceInstanceBindingExistsException.class)
	@ResponseBody
	public ResponseEntity<ErrorMessage> handleException(
			ServiceInstanceBindingExistsException ex, 
			HttpServletResponse response) {
	    return getErrorResponse(ex.getMessage(), HttpStatus.CONFLICT);
	}
	
}
