package com.api.sample.config;

import org.springframework.beans.factory.config.PropertyPlaceholderConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;

@Configuration
@ComponentScan(basePackages = "com.api.sample")
public class MeteringConfig {
	
	/***************************************************
	 * @project : 서비스 미터링 샘플
	 * @description : 미터링에 필요한 환경 프로퍼티를 앱 구동시에 읽어온다.
	 * @title : properties
	 * @return : PropertyPlaceholderConfigurer
	 ***************************************************/
	@Bean
	public PropertyPlaceholderConfigurer properties() {
		PropertyPlaceholderConfigurer propertyPlaceholderConfigurer = new PropertyPlaceholderConfigurer();
		Resource[] resources = new ClassPathResource[] { 
				new ClassPathResource("metering.properties")
		};
		propertyPlaceholderConfigurer.setLocations(resources);
		propertyPlaceholderConfigurer.setIgnoreUnresolvablePlaceholders(true);
		return propertyPlaceholderConfigurer;
	}
}
